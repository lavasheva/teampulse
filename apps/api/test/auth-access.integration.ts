import 'reflect-metadata'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma.service'
import { GitHubClient } from '../src/auth/github.client'
import { configureApp } from '../src/setup'
import { csrfToken, hash, token } from '../src/auth/security'

describe('OAuth, sessions and workspace access on PostgreSQL', () => {
  let app: INestApplication, prisma: PrismaService, github: GitHubClient
  const oldEnv = { ...process.env }
  const users: string[] = [], organizations: string[] = [], states: string[] = []
  const accounts: Record<string, { id: string; value: string }> = {}
  let organizationId: string, projectId: string, teamId: string, otherTeamId: string, invite: { id: string; token: string }
  const origin = 'http://localhost:5173'

  const api = () => request(app.getHttpServer())
  const headers = (name: string) => ({ Cookie: `tp_session=${accounts[name].value}`,
    Origin: origin, 'X-CSRF-Token': csrfToken(accounts[name].value) })
  const createInvitation = async () => {
    const result = await api().post(`/api/projects/${projectId}/invitations`).set(headers('owner')).expect(201)
    return result.body as { id: string; token: string }
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test')) {
      throw new Error('Integration tests require a dedicated _test database')
    }
    process.env.WEB_ORIGIN = origin
    process.env.GITHUB_CLIENT_ID = 'test-client'
    process.env.GITHUB_CLIENT_SECRET = 'test-secret'
    process.env.GITHUB_CALLBACK_URL = 'http://localhost:3000/api/auth/github/callback'
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = module.createNestApplication()
    configureApp(app)
    await app.init()
    prisma = app.get(PrismaService)
    github = app.get(GitHubClient)
    for (const name of ['owner', 'member', 'observer', 'outsider', 'manager', 'race', 'expired']) {
      const user = await prisma.user.create({ data: { githubId: randomUUID(), githubLogin: name } })
      users.push(user.id)
      const value = token()
      accounts[name] = { id: user.id, value }
      await prisma.session.create({ data: { userId: user.id, tokenHash: hash(value),
        expiresAt: new Date(Date.now() + (name === 'expired' ? -60000 : 3600_000)) } })
    }
    const org = await api().post('/api/organizations').set(headers('owner'))
      .send({ name: 'Integration organization', kind: 'university' }).expect(201)
    organizationId = org.body.id
    organizations.push(organizationId)
    const project = await api().post(`/api/organizations/${organizationId}/projects`).set(headers('owner'))
      .send({ name: 'Integration project', startsOn: '2026-11-01', endsOn: '2026-12-01', teamName: 'First' }).expect(201)
    projectId = project.body.id
    teamId = project.body.teams[0].id
    const team = await api().post(`/api/projects/${projectId}/teams`).set(headers('owner'))
      .send({ name: 'Other team' }).expect(201)
    otherTeamId = team.body.id
    invite = await createInvitation()
    await api().post(`/api/invitations/${invite.token}/accept`).set(headers('member')).send({ teamId }).expect(201)
    await prisma.teamMembership.create({ data: { teamId, projectId, userId: accounts.observer.id, role: 'observer' } })
    await prisma.orgMembership.create({ data: { organizationId, userId: accounts.manager.id, role: 'manager' } })
  })

  afterAll(async () => {
    jest.restoreAllMocks()
    if (prisma) {
      await prisma.oAuthAttempt.deleteMany({ where: { stateHash: { in: states } } })
      await prisma.organization.deleteMany({ where: { id: { in: organizations } } })
      await prisma.user.deleteMany({ where: { id: { in: users } } })
    }
    if (app) await app.close()
    process.env = { ...oldEnv }
  })

  it('authenticates through a browser-bound one-time OAuth callback and rotates the old session', async () => {
    const begin = await api().get('/api/auth/github').expect(302)
    const location = new URL(begin.headers.location)
    const state = location.searchParams.get('state')!
    states.push(hash(state))
    const browserCookie = begin.headers['set-cookie'][0].split(';')[0]
    expect(begin.headers['set-cookie'][0]).toContain('HttpOnly')
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    const attempt = await prisma.oAuthAttempt.findUniqueOrThrow({ where: { stateHash: hash(state) } })
    const githubId = randomUUID()
    const profile = jest.spyOn(github, 'profile').mockResolvedValueOnce({ githubId, githubLogin: 'oauth-member',
      name: 'OAuth member', email: 'verified@example.com', avatarUrl: null, verifiedEmails: ['verified@example.com'] })
    await api().get('/api/auth/github/callback').query({ state, code: 'test-code' }).expect(401)
    expect(profile).not.toHaveBeenCalled()
    const callback = await api().get('/api/auth/github/callback').query({ state, code: 'test-code' })
      .set('Cookie', [browserCookie, `tp_session=${accounts.outsider.value}`]).expect(302)
    expect(callback.headers.location).toBe(origin)
    expect(profile).toHaveBeenCalledWith('test-code', attempt.verifier)
    const user = await prisma.user.findUniqueOrThrow({ where: { githubId } })
    users.push(user.id)
    expect(user.verifiedEmails).toEqual(['verified@example.com'])
    const sessionSetCookie = (callback.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('tp_session='))!
    expect(sessionSetCookie).toContain('HttpOnly')
    expect(sessionSetCookie).toContain('SameSite=Lax')
    const sessionCookie = sessionSetCookie.split(';')[0]
    const me = await api().get('/api/auth/me').set('Cookie', sessionCookie).expect(200)
    expect(me.body.user.id).toBe(user.id)
    expect(me.body.user).not.toHaveProperty('email')
    expect(me.headers['cache-control']).toBe('no-store')
    const value = sessionCookie.slice('tp_session='.length)
    expect(await prisma.session.findUnique({ where: { tokenHash: hash(value) } })).not.toBeNull()
    expect(await prisma.session.findUnique({ where: { tokenHash: hash(accounts.outsider.value) } })).toBeNull()
    // Restore the fixture's outsider session for the remaining access tests.
    await prisma.session.create({ data: { userId: accounts.outsider.id, tokenHash: hash(accounts.outsider.value),
      expiresAt: new Date(Date.now() + 3600_000) } })
    await api().get('/api/auth/github/callback').query({ state, code: 'test-code' }).set('Cookie', browserCookie).expect(401)
    await api().post('/api/auth/logout').set('Cookie', sessionCookie).set('Origin', origin)
      .set('X-CSRF-Token', me.body.csrfToken).expect(204)
    await api().get('/api/auth/me').set('Cookie', sessionCookie).expect(401)
    profile.mockRestore()
  })

  it('rejects expired OAuth states before contacting GitHub', async () => {
    const state = token(), browser = token()
    states.push(hash(state))
    await prisma.oAuthAttempt.create({ data: { stateHash: hash(state), browserHash: hash(browser), verifier: token(),
      expiresAt: new Date(Date.now() - 1000) } })
    await api().get('/api/auth/github/callback').query({ state, code: 'test-code' })
      .set('Cookie', `tp_oauth=${browser}`).expect(401)
  })

  it('rejects anonymous and expired sessions', async () => {
    await api().get('/api/projects').expect(401)
    await api().get('/api/auth/me').set(headers('expired')).expect(401)
  })

  it('blocks mutations without CSRF or from another origin', async () => {
    const body = { name: 'Not created', kind: 'school' }
    await api().post('/api/organizations').set('Cookie', headers('owner').Cookie).send(body).expect(403)
    await api().post('/api/organizations').set(headers('owner')).set('Origin', 'https://evil.example').send(body).expect(403)
    await api().post('/api/organizations').set(headers('owner')).set('X-CSRF-Token', 'wrong').send(body).expect(403)
  })

  it('rejects forged roles, invalid dates, whitespace names and invalid IDs', async () => {
    await api().post('/api/organizations').set(headers('member'))
      .send({ name: 'Org', kind: 'school', role: 'owner' }).expect(400)
    await api().post('/api/organizations').set(headers('owner')).send({ name: '  ', kind: 'school' }).expect(400)
    const base = { name: 'Project', teamName: 'Team', startsOn: '2026-11-01', endsOn: '2026-10-01' }
    await api().post(`/api/organizations/${organizationId}/projects`).set(headers('owner')).send(base).expect(400)
    await api().post(`/api/organizations/${organizationId}/projects`).set(headers('owner'))
      .send({ ...base, startsOn: '2026-02-30', endsOn: '2026-12-01' }).expect(400)
    await api().get('/api/teams/not-a-uuid').set(headers('owner')).expect(400)
  })

  it('shows members only their team and lets observers read it', async () => {
    const list = await api().get('/api/projects').set(headers('member')).expect(200)
    expect(list.body.find((p: { id: string }) => p.id === projectId).teams).toEqual([{ id: teamId, name: 'First' }])
    await api().get(`/api/teams/${teamId}`).set(headers('member')).expect(200)
    await api().get(`/api/teams/${teamId}`).set(headers('observer')).expect(200)
    await api().get(`/api/teams/${otherTeamId}`).set(headers('member')).expect(404)
    await api().get(`/api/teams/${teamId}`).set(headers('outsider')).expect(404)
  })

  it('does not grant all organization projects to a manager', async () => {
    await api().get(`/api/teams/${teamId}`).set(headers('manager')).expect(404)
    const list = await api().get('/api/projects').set(headers('manager')).expect(200)
    expect(list.body).toEqual([])
    const own = await api().post(`/api/organizations/${organizationId}/projects`).set(headers('manager'))
      .send({ name: 'Own project', startsOn: '2026-11-01', endsOn: '2026-12-01', teamName: 'Own team' }).expect(201)
    await api().get(`/api/teams/${own.body.teams[0].id}`).set(headers('manager')).expect(200)
    await api().get(`/api/teams/${own.body.teams[0].id}`).set(headers('owner')).expect(200)
    await api().post(`/api/organizations/${organizationId}/projects`).set(headers('outsider'))
      .send({ name: 'Forbidden', startsOn: '2026-11-01', endsOn: '2026-12-01', teamName: 'Team' }).expect(404)
  })

  it('prevents members and observers from managing teams or invitations', async () => {
    for (const name of ['member', 'observer', 'outsider']) {
      await api().post(`/api/projects/${projectId}/teams`).set(headers(name)).send({ name: 'Forbidden' }).expect(404)
      await api().post(`/api/projects/${projectId}/invitations`).set(headers(name)).expect(404)
    }
  })

  it('stores only the invitation hash and accepts repeat joins idempotently', async () => {
    const stored = await prisma.invitation.findUniqueOrThrow({ where: { id: invite.id } })
    expect(stored.tokenHash).toBe(hash(invite.token))
    expect(stored.tokenHash).not.toBe(invite.token)
    await api().post(`/api/invitations/${invite.token}/accept`).set(headers('member')).send({ teamId }).expect(201)
    expect(await prisma.teamMembership.count({ where: { projectId, userId: accounts.member.id } })).toBe(1)
    await api().post(`/api/invitations/${invite.token}/accept`).set(headers('member'))
      .send({ teamId: otherTeamId }).expect(409)
    await api().post(`/api/invitations/${invite.token}/accept`).set(headers('outsider'))
      .send({ teamId, role: 'owner' }).expect(400)
  })

  it('enforces one team per project under concurrent joins', async () => {
    const results = await Promise.all([teamId, otherTeamId].map(id => api()
      .post(`/api/invitations/${invite.token}/accept`).set(headers('race')).send({ teamId: id })))
    expect(results.map(r => r.status).sort()).toEqual([201, 409])
    expect(await prisma.teamMembership.count({ where: { projectId, userId: accounts.race.id } })).toBe(1)
  })

  it('rejects expired and revoked invitations and teams from another project', async () => {
    const expired = await createInvitation()
    await prisma.invitation.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await api().get(`/api/invitations/${expired.token}`).set(headers('outsider')).expect(404)
    await api().post(`/api/invitations/${expired.token}/accept`).set(headers('outsider')).send({ teamId }).expect(404)
    const revoked = await createInvitation()
    await api().delete(`/api/projects/${projectId}/invitations/${revoked.id}`).set(headers('member')).expect(404)
    await api().delete(`/api/projects/${projectId}/invitations/${revoked.id}`).set(headers('owner')).expect(204)
    await api().post(`/api/invitations/${revoked.token}/accept`).set(headers('outsider')).send({ teamId }).expect(404)
    await api().post(`/api/invitations/${invite.token}/accept`).set(headers('outsider'))
      .send({ teamId: randomUUID() }).expect(404)
  })
})
