import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma.service'
import { configureApp } from '../src/setup'
import { csrfToken, hash, token } from '../src/auth/security'
import { AnalyticsInputService } from '../src/analytics/input.service'

describe('access management', () => {
  const oldEnv = { ...process.env }, users: Record<string, { id: string; login: string; session: string }> = {}
  let app: INestApplication, prisma: PrismaService, orgId: string, projectId: string, teamId: string, otherProjectId: string, otherTeamId: string
  const api = () => request(app.getHttpServer())
  const headers = (name: string) => ({ Cookie: `tp_session=${users[name].session}`, Origin: 'http://localhost:5173', 'X-CSRF-Token': csrfToken(users[name].session) })
  const path = (user = 'member', team = teamId) => `/api/projects/${projectId}/teams/${team}/members/${users[user].id}`
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test')) throw new Error('Test database required')
    process.env.GITHUB_EVENTS_ENABLED = 'false'; process.env.WEB_ORIGIN = 'http://localhost:5173'
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = module.createNestApplication(); configureApp(app); await app.init(); prisma = app.get(PrismaService)
    for (const name of ['owner', 'manager', 'member', 'observer', 'outsider', 'newManager']) {
      const login = `access-${name}-${randomUUID().slice(0, 8)}`
      const user = await prisma.user.create({ data: { githubId: randomUUID(), githubLogin: login } })
      const session = token(); users[name] = { id: user.id, login, session }
      await prisma.session.create({ data: { userId: user.id, tokenHash: hash(session), expiresAt: new Date(Date.now() + 3600000) } })
    }
    orgId = (await api().post('/api/organizations').set(headers('owner')).send({ name: 'Access fixture', kind: 'university' }).expect(201)).body.id
    const create = async () => (await api().post(`/api/organizations/${orgId}/projects`).set(headers('owner'))
      .send({ name: 'Access project', startsOn: '2026-11-01', endsOn: '2026-12-01', teamName: 'First' }).expect(201)).body
    const project = await create(); projectId = project.id; teamId = project.teams[0].id
    const other = await create(); otherProjectId = other.id; otherTeamId = other.teams[0].id
    await prisma.projectManager.create({ data: { projectId, userId: users.manager.id } })
    await prisma.teamMembership.createMany({ data: [{ projectId, teamId, userId: users.member.id, role: 'participant' },
      { projectId, teamId, userId: users.observer.id, role: 'observer' }] })
    const repository = await prisma.repository.create({ data: { teamId, fullName: 'test/access', externalId: randomUUID(), installationId: '1' } })
    const identity = await prisma.gitIdentity.create({ data: { repositoryId: repository.id, authorKey: 'fixture', userId: users.member.id } })
    await prisma.event.create({ data: { repositoryId: repository.id, externalId: 'commit:fixture', kind: 'commit', authorId: identity.id,
      occurredAt: new Date('2026-11-18T12:00:00Z'), payload: { title: 'History preserved', url: 'https://github.com/test/access' } } })
  })
  afterAll(async () => {
    if (prisma) {
      if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } })
      await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map(user => user.id) } } })
    }
    if (app) await app.close(); process.env = { ...oldEnv }
  })
  it('restricts access administration and does not return invitation hashes', async () => {
    await api().get(`/api/projects/${projectId}/access`).expect(401)
    for (const name of ['member', 'observer', 'outsider']) await api().get(`/api/projects/${projectId}/access`).set(headers(name)).expect(404)
    const owner = (await api().get(`/api/projects/${projectId}/access`).set(headers('owner')).expect(200)).body
    expect(owner.canManageManagers).toBe(true)
    const manager = (await api().get(`/api/projects/${projectId}/access`).set(headers('manager')).expect(200)).body
    expect(manager.canManageManagers).toBe(false); expect(JSON.stringify(manager)).not.toContain('tokenHash')
    await api().get(`/api/projects/${otherProjectId}/access`).set(headers('manager')).expect(404)
  })
  it('lets only the owner appoint and revoke project managers', async () => {
    const url = `/api/projects/${projectId}/managers`
    await api().post(url).set(headers('manager')).send({ githubLogin: users.newManager.login }).expect(404)
    await api().post(url).set(headers('owner')).send({ githubLogin: users.newManager.login.toUpperCase() }).expect(201)
    await api().post(url).set(headers('owner')).send({ githubLogin: users.newManager.login }).expect(201)
    await api().get(`/api/projects/${projectId}/access`).set(headers('newManager')).expect(200)
    await api().get(`/api/projects/${otherProjectId}/access`).set(headers('newManager')).expect(404)
    await api().delete(`${url}/${users.owner.id}`).set(headers('owner')).expect(400)
    await api().delete(`${url}/${users.newManager.id}`).set(headers('owner')).expect(204)
    await api().get(`/api/projects/${projectId}/access`).set(headers('newManager')).expect(404)
    await api().post(url).set(headers('owner')).send({ githubLogin: 'not-registered-fixture' }).expect(400)
  })
  it('enforces CSRF, DTO role validation and team/project boundaries', async () => {
    await api().put(path()).set('Cookie', headers('owner').Cookie).send({ role: 'observer' }).expect(403)
    await api().put(path()).set(headers('owner')).send({ role: 'owner' }).expect(400)
    for (const name of ['member', 'observer', 'outsider']) await api().put(path()).set(headers(name)).send({ role: 'observer' }).expect(404)
    await api().put(path('member', otherTeamId)).set(headers('owner')).send({ role: 'observer' }).expect(404)
  })
  it('changes roles, invalidates analytics and preserves original event attribution', async () => {
    await api().put(path()).set(headers('manager')).send({ role: 'observer' }).expect(204)
    const input = await app.get(AnalyticsInputService).week(teamId, '2026-11-16', 1)
    expect(input.members).toHaveLength(0); expect(input.events[0].actorId).toBeNull()
    expect(await prisma.event.count({ where: { author: { userId: users.member.id } } })).toBe(1)
    expect(await prisma.recalculationRequest.count({ where: { teamId } })).toBe(1)
    await api().post(`/api/teams/${teamId}/identities/${randomUUID()}/claim`).set(headers('member')).expect(403)
    await api().put(path()).set(headers('manager')).send({ role: 'participant' }).expect(204)
    expect((await app.get(AnalyticsInputService).week(teamId, '2026-11-16', 2)).events[0].actorId).toBe(users.member.id)
  })
  it('honors observer invitations, prevents role escalation on rejoining and revokes links', async () => {
    const url = `/api/projects/${projectId}/invitations`
    const observer = (await api().post(url).set(headers('manager')).send({ role: 'observer' }).expect(201)).body
    expect((await api().get(`/api/invitations/${observer.token}`).set(headers('outsider')).expect(200)).body.role).toBe('observer')
    await api().post(`/api/invitations/${observer.token}/accept`).set(headers('outsider')).send({ teamId, role: 'participant' }).expect(400)
    await api().post(`/api/invitations/${observer.token}/accept`).set(headers('outsider')).send({ teamId }).expect(201)
    const participant = (await api().post(url).set(headers('manager')).send({}).expect(201)).body
    await api().post(`/api/invitations/${participant.token}/accept`).set(headers('outsider')).send({ teamId }).expect(201)
    expect((await prisma.teamMembership.findUniqueOrThrow({ where: { teamId_userId: { teamId, userId: users.outsider.id } } })).role).toBe('observer')
    const list = (await api().get(`/api/projects/${projectId}/access`).set(headers('manager')).expect(200)).body
    expect(list.invitations).toHaveLength(2); expect(JSON.stringify(list)).not.toContain(observer.token)
    await api().delete(`${url}/${observer.id}`).set(headers('member')).expect(404)
    await api().delete(`/api/projects/${otherProjectId}/invitations/${observer.id}`).set(headers('owner')).expect(404)
    await api().delete(`${url}/${observer.id}`).set(headers('manager')).expect(204)
    await api().get(`/api/invitations/${observer.token}`).set(headers('outsider')).expect(404)
    await api().post(`/api/invitations/${observer.token}/accept`).set(headers('outsider')).send({ teamId }).expect(404)
  })
  it('removes a membership immediately without deleting history or independent manager access', async () => {
    await api().delete(path()).set(headers('manager')).expect(204)
    await api().get(`/api/teams/${teamId}`).set(headers('member')).expect(404)
    expect(await prisma.event.count({ where: { repository: { teamId } } })).toBe(1)
    expect((await app.get(AnalyticsInputService).week(teamId, '2026-11-16', 3)).events[0].actorId).toBeNull()
    await prisma.teamMembership.create({ data: { projectId, teamId, userId: users.manager.id, role: 'participant' } })
    await api().delete(path('manager')).set(headers('owner')).expect(204)
    await api().get(`/api/teams/${teamId}`).set(headers('manager')).expect(200)
    await api().delete(path()).set(headers('manager')).expect(404)
  })
})
