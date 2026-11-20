import 'reflect-metadata'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma.service'
import { AnalyticsInputService } from '../src/analytics/input.service'
import { configureApp } from '../src/setup'
import { csrfToken, hash, token } from '../src/auth/security'

describe('client workspace and settings API', () => {
  const oldEnv = { ...process.env }, accounts: Record<string, { id: string; value: string }> = {}
  let app: INestApplication, prisma: PrismaService, orgId: string, projectId: string, otherProjectId: string, teamId: string, otherTeamId: string
  const api = () => request(app.getHttpServer())
  const headers = (name: string) => ({ Cookie: `tp_session=${accounts[name].value}`,
    Origin: 'http://localhost:5173', 'X-CSRF-Token': csrfToken(accounts[name].value) })
  const settings = () => ({ name: 'Updated project', startsOn: '2026-11-01', endsOn: '2026-12-01',
    weights: { code: 25, pullRequests: 25, reviews: 25, issues: 25 },
    thresholds: { inactivity: 7, imbalance: 60, lateBurst: 50, excluded: 50 },
    milestones: [{ id: randomUUID(), title: 'MVP', date: '2026-11-25' }] })

  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test')) throw new Error('Test database required')
    process.env.GITHUB_EVENTS_ENABLED = 'false'; process.env.WEB_ORIGIN = 'http://localhost:5173'
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = module.createNestApplication(); configureApp(app); await app.init(); prisma = app.get(PrismaService)
    for (const name of ['owner', 'member', 'observer', 'stranger', 'manager']) {
      const user = await prisma.user.create({ data: { githubId: randomUUID(), githubLogin: name } })
      const value = token(); accounts[name] = { id: user.id, value }
      await prisma.session.create({ data: { userId: user.id, tokenHash: hash(value), expiresAt: new Date(Date.now() + 3600000) } })
    }
    const org = await api().post('/api/organizations').set(headers('owner')).send({ name: 'Client test', kind: 'university' }).expect(201)
    orgId = org.body.id
    const create = async (name: string) => (await api().post(`/api/organizations/${orgId}/projects`).set(headers('owner'))
      .send({ name, startsOn: '2026-11-01', endsOn: '2026-12-01', teamName: 'First team' }).expect(201)).body
    const project = await create('Client project'); projectId = project.id; teamId = project.teams[0].id
    const other = await create('Other project'); otherProjectId = other.id
    otherTeamId = (await api().post(`/api/projects/${projectId}/teams`).set(headers('owner')).send({ name: 'Other team' }).expect(201)).body.id
    await prisma.orgMembership.create({ data: { organizationId: orgId, userId: accounts.manager.id, role: 'manager' } })
    await prisma.projectManager.create({ data: { projectId, userId: accounts.manager.id } })
    await prisma.teamMembership.createMany({ data: [{ teamId, projectId, userId: accounts.member.id, role: 'participant' },
      { teamId, projectId, userId: accounts.observer.id, role: 'observer' }] })
    const repository = await prisma.repository.create({ data: { teamId, fullName: 'test/client', externalId: randomUUID(), installationId: '1' } })
    const identity = await prisma.gitIdentity.create({ data: { repositoryId: repository.id, authorKey: 'test', userId: accounts.member.id } })
    await prisma.event.createMany({ data: ['2026-11-18T12:00:00Z', '2026-11-23T00:00:00Z'].map((date, i) => ({
      repositoryId: repository.id, externalId: `commit:${i}`, kind: 'commit', authorId: identity.id, occurredAt: new Date(date),
      payload: { title: 'Collected event', url: 'https://github.com/test/client' },
    })) })
  })
  afterAll(async () => {
    if (prisma) {
      if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } })
      await prisma.user.deleteMany({ where: { id: { in: Object.values(accounts).map(a => a.id) } } })
    }
    if (app) await app.close(); process.env = { ...oldEnv }
  })

  it('projects team visibility and capabilities on the server, without demo roles or tokens', async () => {
    await api().get('/api/workspace').expect(401)
    const member = (await api().get('/api/workspace').set(headers('member')).expect(200)).body
    expect(member.projects).toHaveLength(1)
    expect(member.projects[0].teams.map((team: { id: string }) => team.id)).toEqual([teamId])
    expect(member.projects[0].canManage).toBe(false); expect(member.projects[0].teams[0].canConnect).toBe(true)
    expect(member.projects[0].analytics.status).toBe('enabled')
    const observer = (await api().get('/api/workspace').set(headers('observer')).expect(200)).body
    expect(observer.projects[0].teams[0].canConnect).toBe(false)
    const manager = (await api().get('/api/workspace').set(headers('manager')).expect(200)).body
    expect(manager.projects.map((project: { id: string }) => project.id)).toEqual([projectId])
    expect(manager.projects[0].teams).toHaveLength(2); expect(manager.projects[0].canManage).toBe(true)
    expect((await api().get('/api/workspace').set(headers('owner')).expect(200)).body.projects).toHaveLength(2)
    expect((await api().get('/api/workspace').set(headers('stranger')).expect(200)).body.projects).toEqual([])
    expect(JSON.stringify(member)).not.toContain('tokenHash'); expect(JSON.stringify(member)).not.toContain('inviteCode')
  })

  it('persists validated settings and requests recalculation of affected weeks', async () => {
    const input = settings()
    await api().put(`/api/projects/${projectId}/settings`).set(headers('owner')).send(input).expect(200, input)
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { milestones: true } })
    expect(project.name).toBe(input.name); expect(project.milestones[0].title).toBe('MVP')
    expect(await prisma.recalculationRequest.count({ where: { teamId } })).toBe(2)
  })

  it('does not let a member, observer or another project manager mutate settings', async () => {
    for (const name of ['member', 'observer', 'stranger']) {
      await api().put(`/api/projects/${projectId}/settings`).set(headers(name)).send(settings()).expect(404)
    }
    await api().put(`/api/projects/${otherProjectId}/settings`).set(headers('manager')).send(settings()).expect(404)
    await api().put(`/api/projects/${projectId}/settings`).set('Cookie', headers('owner').Cookie).send(settings()).expect(403)
  })

  it('rejects invalid weights, dates, milestones and injected permissions', async () => {
    const input = settings()
    for (const invalid of [{ ...input, weights: { ...input.weights, code: 99 } }, { ...input, endsOn: '2026-10-01' },
      { ...input, thresholds: { ...input.thresholds, inactivity: 0 } }, { ...input, milestones: [{ ...input.milestones[0], date: '2027-01-01' }] },
      { ...input, canManage: true }, { ...input, milestones: [input.milestones[0], input.milestones[0]] }]) {
      await api().put(`/api/projects/${projectId}/settings`).set(headers('owner')).send(invalid).expect(400)
    }
    const foreign = await prisma.milestone.create({ data: { projectId: otherProjectId, title: 'Other', date: new Date('2026-11-25') } })
    await api().put(`/api/projects/${projectId}/settings`).set(headers('owner'))
      .send({ ...input, name: 'Must roll back', milestones: [{ id: foreign.id, title: 'Hijack', date: '2026-11-25' }] }).expect(400)
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).name).not.toBe('Must roll back')
  })

  it('returns real member event counts without claiming they are calculated contribution', async () => {
    const result = (await api().get(`/api/teams/${teamId}/members/${accounts.member.id}`).set(headers('observer')).expect(200)).body
    expect(result.rawActivity).toEqual([{ kind: 'commit', count: 2 }]); expect(result.analytics.status).toBe('enabled')
    expect(result.user).not.toHaveProperty('email')
    await api().get(`/api/teams/${teamId}/members/${accounts.member.id}`).set(headers('stranger')).expect(404)
    await api().get(`/api/teams/${otherTeamId}/members/${accounts.member.id}`).set(headers('member')).expect(404)
  })

  it('builds an internal weekly analytics input with a consistent period and no credentials', async () => {
    const input = await app.get(AnalyticsInputService).week(teamId, '2026-11-16', 3)
    expect(input.members.map(member => member.id)).toEqual([accounts.member.id])
    expect(input.events).toHaveLength(1); expect(input.events[0].actorId).toBe(accounts.member.id)
    expect(input.weekEndsBefore).toBe('2026-11-23'); expect(input.sourceVersion).toBe(3)
    expect(JSON.stringify(input)).not.toContain('tokenHash'); expect(input.members[0]).not.toHaveProperty('verifiedEmails')
    await expect(app.get(AnalyticsInputService).week(teamId, '2026-11-18', 1)).rejects.toThrow()
  })
})
