import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma.service'
import { configureApp } from '../src/setup'
import { csrfToken, hash, token } from '../src/auth/security'
import * as auditWriter from '../src/workspace/audit'

describe('filtered activity and project audit', () => {
  const oldEnv = { ...process.env }, users: Record<string, { id: string; login: string; session: string }> = {}
  let app: INestApplication, prisma: PrismaService, orgId: string, projectId: string, otherProjectId: string, teamId: string, otherTeamId: string
  const api = () => request(app.getHttpServer())
  const headers = (name: string) => ({ Cookie: `tp_session=${users[name].session}`, Origin: 'http://localhost:5173', 'X-CSRF-Token': csrfToken(users[name].session) })
  const feed = (query: Record<string, string> = {}, team = teamId, user = 'member') => api().get(`/api/teams/${team}/activity`).set(headers(user)).query(query)
  const audit = (query: Record<string, string> = {}, project = projectId, user = 'owner') => api().get(`/api/projects/${project}/audit`).set(headers(user)).query(query)
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test')) throw new Error('Test database required')
    process.env.GITHUB_EVENTS_ENABLED = 'false'; process.env.WEB_ORIGIN = 'http://localhost:5173'
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = module.createNestApplication(); configureApp(app); await app.init(); prisma = app.get(PrismaService)
    for (const name of ['owner', 'manager', 'member', 'observer', 'stranger']) {
      const login = `audit-${name}-${randomUUID().slice(0, 8)}`
      const user = await prisma.user.create({ data: { githubId: randomUUID(), githubLogin: login, email: 'private@example.test' } })
      const session = token(); users[name] = { id: user.id, login, session }
      await prisma.session.create({ data: { userId: user.id, tokenHash: hash(session), expiresAt: new Date(Date.now() + 3600000) } })
    }
    orgId = (await api().post('/api/organizations').set(headers('owner')).send({ name: 'Activity fixture', kind: 'university' }).expect(201)).body.id
    const create = async () => (await api().post(`/api/organizations/${orgId}/projects`).set(headers('owner'))
      .send({ name: 'Activity project', startsOn: '2026-11-01', endsOn: '2026-12-01', teamName: 'Activity team' }).expect(201)).body
    const project = await create(); projectId = project.id; teamId = project.teams[0].id
    const other = await create(); otherProjectId = other.id; otherTeamId = other.teams[0].id
    await prisma.projectManager.create({ data: { projectId, userId: users.manager.id } })
    await prisma.teamMembership.createMany({ data: [{ projectId, teamId, userId: users.member.id, role: 'participant' }, { projectId, teamId, userId: users.observer.id, role: 'observer' }] })
    const repository = await prisma.repository.create({ data: { teamId, fullName: 'test/activity', externalId: randomUUID(), installationId: '1' } })
    const identity = await prisma.gitIdentity.create({ data: { repositoryId: repository.id, authorKey: 'fixture', userId: users.member.id } })
    await prisma.event.createMany({ data: Array.from({ length: 53 }, (_, i) => ({ repositoryId: repository.id, externalId: `commit:${i}`, kind: 'commit' as const,
      authorId: identity.id, occurredAt: new Date('2026-11-18T12:00:00Z'), payload: { title: `Commit ${i}`, url: 'https://github.com/test/activity' } })) })
    for (const [date, kind] of [['2026-11-17T23:59:59Z', 'issue_opened'], ['2026-11-19T00:00:00Z', 'review']] as const) {
      await prisma.event.create({ data: { repositoryId: repository.id, externalId: date, kind, occurredAt: new Date(date), payload: { title: kind, url: 'https://github.com/test/activity' } } })
    }
  })
  afterAll(async () => {
    jest.restoreAllMocks()
    if (prisma) {
      if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } })
      await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map(user => user.id) } } })
    }
    if (app) await app.close(); process.env = { ...oldEnv }
  })
  it('sorts by time and pages equal timestamps without duplicates or omissions', async () => {
    const first = (await feed().expect(200)).body
    expect(first.events[0].kind).toBe('review'); expect(first.events).toHaveLength(50)
    const second = (await feed({ cursor: first.nextCursor }).expect(200)).body
    expect(second.events).toHaveLength(5); expect(second.nextCursor).toBeNull()
    const ids = [...first.events, ...second.events].map(event => event.id)
    expect(new Set(ids).size).toBe(55)
    expect(second.events.at(-1).kind).toBe('issue_opened')
    const expected = await prisma.event.findMany({ where: { repository: { teamId } }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], select: { id: true } })
    expect(ids).toEqual(expected.map(event => event.id))
  })
  it('filters author, kind and inclusive UTC dates on the server', async () => {
    const first = (await feed({ kind: 'commit', author: users.member.id, from: '2026-11-18', to: '2026-11-18' }).expect(200)).body
    expect(first.events).toHaveLength(50)
    const second = (await feed({ kind: 'commit', author: users.member.id, from: '2026-11-18', to: '2026-11-18', cursor: first.nextCursor }).expect(200)).body
    expect(second.events).toHaveLength(3)
    expect((await feed({ author: 'unmatched' }).expect(200)).body.events.map((event: { kind: string }) => event.kind)).toEqual(['review', 'issue_opened'])
    expect((await feed({ from: '2026-11-19', to: '2026-11-19' }).expect(200)).body.events).toHaveLength(1)
    expect((await feed({ author: users.stranger.id }).expect(200)).body.events).toEqual([])
  })
  it('rejects malformed filters and cursors and enforces team access', async () => {
    const invalid: Record<string, string>[] = [{ kind: 'made_up' }, { author: 'not-a-uuid' }, { from: '2026-02-30' }, { from: '2026-11-20', to: '2026-11-19' }, { cursor: 'bad!' }, { extra: 'injected' }]
    for (const query of invalid) await feed(query).expect(400)
    await api().get(`/api/teams/${teamId}/activity`).expect(401)
    await feed({}, teamId, 'stranger').expect(404); await feed({}, otherTeamId).expect(404)
    await feed({ kind: ['commit', 'review'] } as unknown as Record<string, string>).expect(400)
    const cursor = (await feed().expect(200)).body.nextCursor
    await feed({ kind: 'commit', cursor }).expect(400)
    await feed({ cursor }, otherTeamId, 'owner').expect(400)
    await feed({}, teamId, 'observer').expect(200)
  })
  it('records only successful state changes and never stores invitation/session secrets', async () => {
    const managers = `/api/projects/${projectId}/managers`
    await api().post(managers).set(headers('owner')).send({ githubLogin: users.stranger.login }).expect(201)
    await api().post(managers).set(headers('owner')).send({ githubLogin: users.stranger.login }).expect(201)
    await api().post(managers).set(headers('member')).send({ githubLogin: users.member.login }).expect(404)
    expect(await prisma.projectAudit.count({ where: { projectId, action: 'manager_added' } })).toBe(1)
    await api().delete(`${managers}/${users.stranger.id}`).set(headers('owner')).expect(204)
    const memberUrl = `/api/projects/${projectId}/teams/${teamId}/members/${users.member.id}`
    await api().put(memberUrl).set(headers('manager')).send({ role: 'observer' }).expect(204)
    await api().put(memberUrl).set(headers('manager')).send({ role: 'observer' }).expect(204)
    expect(await prisma.projectAudit.count({ where: { projectId, action: 'member_role_changed' } })).toBe(1)
    const invitation = (await api().post(`/api/projects/${projectId}/invitations`).set(headers('manager')).send({ role: 'observer' }).expect(201)).body
    await api().post(`/api/invitations/${invitation.token}/accept`).set(headers('stranger')).send({ teamId }).expect(201)
    await api().delete(`/api/projects/${projectId}/invitations/${invitation.id}`).set(headers('manager')).expect(204)
    await api().put(memberUrl).set(headers('manager')).send({ role: 'participant' }).expect(204)
    const log = (await audit().expect(200)).body
    expect(log.entries.map((entry: { action: string }) => entry.action)).toEqual(expect.arrayContaining(['manager_added', 'manager_removed', 'member_role_changed', 'invitation_created', 'invitation_revoked', 'member_joined']))
    const serialized = JSON.stringify(log)
    for (const secret of [invitation.token, hash(invitation.token), users.owner.session, 'private@example.test', 'tokenHash']) expect(serialized).not.toContain(secret)
    expect(log.entries.find((entry: { action: string }) => entry.action === 'member_role_changed')).toMatchObject({ beforeRole: 'observer', afterRole: 'participant' })
  })
  it('restricts the journal to managers of this project and supports stable pagination', async () => {
    await api().get(`/api/projects/${projectId}/audit`).expect(401)
    for (const user of ['member', 'observer', 'stranger']) await audit({}, projectId, user).expect(404)
    await audit({}, otherProjectId, 'manager').expect(404)
    await prisma.projectAudit.createMany({ data: Array.from({ length: 53 }, () => ({ projectId, actorId: users.owner.id, actorLogin: users.owner.login,
      action: 'settings_updated' as const, createdAt: new Date('2030-01-01T00:00:00Z') })) })
    const first = (await audit().expect(200)).body
    expect(first.entries).toHaveLength(50)
    const second = (await audit({ cursor: first.nextCursor }).expect(200)).body
    expect(new Set([...first.entries, ...second.entries].map(entry => entry.id)).size).toBe(await prisma.projectAudit.count({ where: { projectId } }))
    await audit({ cursor: first.nextCursor }, otherProjectId).expect(400)
    await audit({ cursor: 'invalid' }).expect(400)
  })
  it('rolls back a membership change if its audit write fails', async () => {
    const count = await prisma.projectAudit.count({ where: { projectId } })
    const spy = jest.spyOn(auditWriter, 'recordAudit').mockRejectedValueOnce(new Error('Simulated audit outage'))
    try {
      await api().put(`/api/projects/${projectId}/teams/${teamId}/members/${users.member.id}`).set(headers('manager')).send({ role: 'observer' }).expect(500)
      expect((await prisma.teamMembership.findUniqueOrThrow({ where: { teamId_userId: { teamId, userId: users.member.id } } })).role).toBe('participant')
      expect(await prisma.projectAudit.count({ where: { projectId } })).toBe(count)
    } finally { spy.mockRestore() }
  })
})
