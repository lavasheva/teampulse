import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma.service'
import { AnalyticsService } from '../src/analytics/analytics.service'
import { AnalyticsInputService } from '../src/analytics/input.service'
import { AnalyticsQueue } from '../src/analytics/analytics.queue'
import { configureApp } from '../src/setup'
import { csrfToken, hash, token } from '../src/auth/security'
import { invalidateWeeks } from '../src/github/event.store'

describe('persisted analytics and access', () => {
  const oldEnv = { ...process.env }, users: Record<string, { id: string; session: string }> = {}
  const now = new Date('2026-11-23T00:00:00Z'), weights = { code: 50, pullRequests: 20, reviews: 20, issues: 10 }
  let app: INestApplication, prisma: PrismaService, analytics: AnalyticsService, orgId: string, projectId: string, teamId: string, otherTeamId: string, repoId: string
  const api = () => request(app.getHttpServer())
  const headers = (user: string) => ({ Cookie: `tp_session=${users[user].session}`, Origin: 'http://localhost:5173', 'X-CSRF-Token': csrfToken(users[user].session) })
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test')) throw new Error('Test database required')
    process.env.GITHUB_EVENTS_ENABLED = 'false'; process.env.SUMMARY_PROVIDER = 'template'; process.env.WEB_ORIGIN = 'http://localhost:5173'
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = module.createNestApplication(); configureApp(app); await app.init(); prisma = app.get(PrismaService); analytics = app.get(AnalyticsService)
    for (const name of ['owner', 'a', 'b', 'c', 'observer', 'outsider']) {
      const user = await prisma.user.create({ data: { githubId: randomUUID(), githubLogin: name } }), session = token()
      users[name] = { id: user.id, session }
      await prisma.session.create({ data: { userId: user.id, tokenHash: hash(session), expiresAt: new Date(Date.now() + 3600000) } })
    }
    const org = await prisma.organization.create({ data: { name: 'Analytics fixture', kind: 'university', memberships: { create: { userId: users.owner.id, role: 'owner' } },
      projects: { create: { name: 'Analytics', startsOn: new Date('2026-11-09'), endsOn: new Date('2026-11-29'), weights,
        thresholds: { inactivity: 7, imbalance: 60, lateBurst: 50, excluded: 50 }, teams: { create: [{ name: 'Measured' }, { name: 'Empty' }] } } } }, include: { projects: { include: { teams: true } } } })
    orgId = org.id; projectId = org.projects[0].id; [teamId, otherTeamId] = org.projects[0].teams.map(team => team.id)
    for (const name of ['a', 'b', 'c', 'observer']) await prisma.teamMembership.create({ data: { teamId, projectId, userId: users[name].id, role: name === 'observer' ? 'observer' : 'participant', joinedAt: new Date('2026-11-09') } })
    const repo = await prisma.repository.create({ data: { teamId, fullName: 'test/analytics', externalId: randomUUID(), installationId: '1', syncStatus: 'complete' } }); repoId = repo.id
    for (const name of ['a', 'b']) {
      const identity = await prisma.gitIdentity.create({ data: { repositoryId: repoId, authorKey: name, userId: users[name].id } })
      const events = name === 'a' ? [
        { id: 'code', kind: 'commit' as const, url: 'https://github.com/test/repo/commit/a', details: { stats: { additions: 40, deletions: 0, total: 40 }, files: [{ filename: 'src/app.ts', status: 'modified', additions: 40, deletions: 0, changes: 40 }] } },
        { id: 'pr-open', kind: 'pr_opened' as const, url: 'https://github.com/test/repo/pull/1', details: {} },
        { id: 'pr-merge', kind: 'pr_merged' as const, url: 'https://github.com/test/repo/pull/1', details: {} },
      ] : [{ id: 'review', kind: 'review' as const, url: 'https://github.com/test/repo/pull/1#review-1', details: { hasBody: true } },
        { id: 'issue', kind: 'issue_opened' as const, url: 'https://github.com/test/repo/issues/1', details: {} }]
      for (const event of events) await prisma.event.create({ data: { repositoryId: repoId, externalId: event.id, authorId: identity.id, kind: event.kind, occurredAt: new Date('2026-11-18T12:00:00Z'), payload: { title: event.id, url: event.url }, details: event.details } })
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
  it('does not turn unfinished import or pending deliveries into an empty calculation', async () => {
    await prisma.repository.update({ where: { id: repoId }, data: { syncStatus: 'pending' } })
    expect(await analytics.run(teamId, now)).toBe(false)
    expect((await analytics.get(teamId, now)).status).toBe('loading'); expect((await analytics.get(teamId, now)).project).toBeNull()
    await prisma.repository.update({ where: { id: repoId }, data: { syncStatus: 'complete' } })
    const delivery = await prisma.webhookDelivery.create({ data: { id: randomUUID(), repositoryId: repoId, eventName: 'push', payload: {} } })
    expect(await analytics.run(teamId, now)).toBe(false)
    expect((await analytics.get(teamId, now)).status).toBe('loading')
    await prisma.webhookDelivery.delete({ where: { id: delivery.id } })
  })
  it('persists the hand-calculated result, empty completed weeks and template summaries', async () => {
    expect(await analytics.run(teamId, now)).toBe(true)
    const result = await analytics.get(teamId, now)
    expect(result.status).toBe('ready'); expect(result.weeks).toHaveLength(2)
    const a = result.project!.members.find(member => member.userId === users.a.id)!
    expect(a.totalPoints).toBe(1.6); expect(a.sharePercent).toBeCloseTo(1.6 / 2.05 * 100)
    expect(result.project!.members.find(member => member.userId === users.b.id)!.totalPoints).toBe(0.45)
    expect(result.project!.members).toHaveLength(3)
    expect(result.weeks[1].result.flags.some(flag => flag.kind === 'teamInactivity')).toBe(true)
    expect(result.weeks.every(week => week.summary.source === 'template')).toBe(true)
    expect(await analytics.run(teamId, now)).toBe(false)
    expect(await prisma.weeklySnapshot.count({ where: { teamId } })).toBe(2)
  })
  it('keeps access scoped and applies CSRF and the hourly manual refresh limit', async () => {
    await api().get(`/api/teams/${teamId}/analytics`).expect(401)
    await api().get(`/api/teams/${teamId}/analytics`).set(headers('outsider')).expect(404)
    await api().get(`/api/teams/${otherTeamId}/analytics`).set(headers('a')).expect(404)
    await api().get(`/api/teams/${teamId}/analytics`).set(headers('observer')).expect(200)
    await api().post(`/api/teams/${teamId}/analytics/refresh`).set(headers('observer')).expect(403)
    await api().post(`/api/teams/${teamId}/analytics/refresh`).set('Cookie', headers('a').Cookie).expect(403)
    await api().post(`/api/teams/${teamId}/analytics/refresh`).set(headers('a')).expect(201)
    await api().post(`/api/teams/${teamId}/analytics/refresh`).set(headers('a')).expect(409)
    const event = await prisma.event.findFirstOrThrow({ where: { repositoryId: repoId } })
    await api().get(`/api/teams/${teamId}/activity/${event.id}`).expect(401)
    await api().get(`/api/teams/${teamId}/activity/${event.id}`).set(headers('outsider')).expect(404)
    await api().get(`/api/teams/${otherTeamId}/activity/${event.id}`).set(headers('owner')).expect(404)
    const evidence = await api().get(`/api/teams/${teamId}/activity/${event.id}`).set(headers('observer')).expect(200)
    expect(evidence.body.id).toBe(event.id); expect(evidence.body.payload.url).toContain('https://github.com/')
    await analytics.run(teamId, now)
  })
  it('rejects an obsolete calculation and recomputes all weeks after an old change', async () => {
    await prisma.$transaction(tx => invalidateWeeks(tx, teamId, [new Date('2026-11-09')]))
    const before = await prisma.teamAnalysis.findUniqueOrThrow({ where: { teamId } })
    const input = app.get(AnalyticsInputService), original = input.snapshot.bind(input)
    const spy = jest.spyOn(input, 'snapshot').mockImplementationOnce(async (...args) => {
      const snapshot = await original(...args)
      await prisma.$transaction(tx => invalidateWeeks(tx, teamId, [new Date('2026-11-09')]))
      return snapshot
    })
    try { expect(await analytics.run(teamId, now)).toBe(false) } finally { spy.mockRestore() }
    expect((await prisma.teamAnalysis.findUniqueOrThrow({ where: { teamId } })).sourceVersion).toBe(before.sourceVersion)
    expect(await analytics.run(teamId, now)).toBe(true)
    const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } })
    expect((await prisma.weeklySnapshot.findMany({ where: { teamId } })).every(snapshot => snapshot.sourceVersion === team.analyticsVersion)).toBe(true)
    const requests = await prisma.recalculationRequest.findMany({ where: { teamId } })
    expect(requests.every(row => row.processedVersion === row.version)).toBe(true)
  })
  it('validates Prisma JSON and preserves the prior snapshot on calculation failure', async () => {
    await prisma.project.update({ where: { id: projectId }, data: { weights: { code: 101 } } })
    await prisma.$transaction(tx => invalidateWeeks(tx, teamId, [], true))
    expect(await analytics.run(teamId, now)).toBe(false)
    const failed = await analytics.get(teamId, now)
    expect(failed.status).toBe('error'); expect(failed.project).not.toBeNull()
    expect((await prisma.teamAnalysis.findUniqueOrThrow({ where: { teamId } })).error).toBe('ANALYTICS_FAILED')
    await prisma.project.update({ where: { id: projectId }, data: { weights } })
    await prisma.$transaction(tx => invalidateWeeks(tx, teamId, [], true))
    expect(await analytics.run(teamId, now)).toBe(true)
  })
  it('falls back to a template without losing metrics when optional AI configuration is incomplete', async () => {
    process.env.SUMMARY_PROVIDER = 'yandexgpt'; delete process.env.YANDEX_GPT_API_KEY
    await prisma.$transaction(tx => invalidateWeeks(tx, teamId, [], true))
    try {
      expect(await analytics.run(teamId, now)).toBe(true)
      const result = await analytics.get(teamId, now)
      expect(result.status).toBe('ready'); expect(result.project!.totalPoints).toBe(2.05)
      expect(result.weeks[0].summary.source).toBe('template')
      expect(result.weeks[0].summary.fallbackReason).toBe('provider_error')
    } finally { process.env.SUMMARY_PROVIDER = 'template' }
  })
  it('processes a completed empty source through real BullMQ', async () => {
    await prisma.repository.create({ data: { teamId: otherTeamId, fullName: 'test/empty', externalId: randomUUID(), installationId: '1', syncStatus: 'complete' } })
    process.env.GITHUB_EVENTS_ENABLED = 'true'; process.env.ANALYTICS_ENABLED = 'true'
    process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15'; process.env.GITHUB_QUEUE_NAME = `analytics-test-${randomUUID()}`
    const queue = new AnalyticsQueue(prisma, analytics); queue.onModuleInit()
    try {
      await queue.dispatch()
      const deadline = Date.now() + 15000
      while (Date.now() < deadline && !(await prisma.teamAnalysis.findUnique({ where: { teamId: otherTeamId } }))?.computedAt) await new Promise(resolve => setTimeout(resolve, 100))
      const result = await analytics.get(otherTeamId)
      expect(result.status).toBe('ready'); expect(result.project!.totalPoints).toBe(0)
      expect(result.weeks.length).toBeGreaterThan(0)
    } finally { await queue.onModuleDestroy(); process.env.GITHUB_EVENTS_ENABLED = 'false' }
  })
})
