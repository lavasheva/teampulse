import 'reflect-metadata'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma.service'
import { configureApp } from '../src/setup'
import { csrfToken, hash, token } from '../src/auth/security'
import { HistorySource, GitHubRateLimit } from '../src/github/history.source'
import { HistoryService } from '../src/github/history.service'
import { EventStore, type CollectedEvent } from '../src/github/event.store'
import { DeliveryProcessor } from '../src/github/delivery.processor'
import { EventsQueue } from '../src/github/events.queue'

describe('history checkpoints and author resolution on PostgreSQL', () => {
  const oldEnv = { ...process.env }, source = { next: jest.fn() }
  let app: INestApplication, prisma: PrismaService, history: HistoryService, store: EventStore
  let orgId: string, projectId: string, teamId: string, otherTeamId: string, repositoryId: string
  const accounts: Record<string, { id: string; githubId: string; value: string }> = {}
  const anchor = '2026-11-18T12:00:00.000Z'
  const api = () => request(app.getHttpServer())
  const headers = (name: string) => ({ Cookie: `tp_session=${accounts[name].value}`,
    Origin: 'http://localhost:5173', 'X-CSRF-Token': csrfToken(accounts[name].value) })
  const event = (sha = 'a', email: string | null = 'member@example.com', githubId: string | null = null): CollectedEvent => ({
    externalId: `commit:${sha.repeat(40)}`, kind: 'commit', occurredAt: anchor,
    author: { key: email ? `email:${email}` : `github:${githubId}`, email, githubId, login: 'untrusted-login' },
    payload: { title: 'Original webhook title', url: 'https://github.com/test/repo/commit/a' },
  })
  async function save(events: CollectedEvent[]) {
    const repository = await prisma.repository.findUniqueOrThrow({ where: { id: repositoryId } })
    await prisma.$transaction(tx => store.save(tx, repository, events), { timeout: 30000 })
  }

  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test')) throw new Error('Dedicated test database required')
    process.env.GITHUB_EVENTS_ENABLED = 'false'
    process.env.WEB_ORIGIN = 'http://localhost:5173'
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(HistorySource).useValue(source).compile()
    app = module.createNestApplication(); configureApp(app); await app.init()
    prisma = app.get(PrismaService); history = app.get(HistoryService); store = app.get(EventStore)
    for (const name of ['member', 'second', 'observer', 'stranger', 'manager']) {
      const user = await prisma.user.create({ data: { githubId: randomUUID(), githubLogin: name,
        verifiedEmails: name === 'member' ? ['member@example.com'] : [] } })
      const value = token(); accounts[name] = { id: user.id, githubId: user.githubId, value }
      await prisma.session.create({ data: { userId: user.id, tokenHash: hash(value), expiresAt: new Date(Date.now() + 3600000) } })
    }
    const org = await prisma.organization.create({ data: { name: 'History test', kind: 'school',
      memberships: { create: { userId: accounts.manager.id, role: 'owner' } }, projects: { create: {
        name: 'History', startsOn: new Date(anchor), endsOn: new Date(anchor), weights: {}, thresholds: {},
        teams: { create: [{ name: 'First' }, { name: 'Other' }] },
      } } }, include: { projects: { include: { teams: true } } } })
    orgId = org.id; projectId = org.projects[0].id; teamId = org.projects[0].teams[0].id; otherTeamId = org.projects[0].teams[1].id
    await prisma.teamMembership.createMany({ data: ['member', 'second', 'observer'].map(name => ({
      teamId, projectId, userId: accounts[name].id, role: name === 'observer' ? 'observer' as const : 'participant' as const,
    })) })
    const repository = await prisma.repository.create({ data: { teamId, installationId: '123',
      externalId: randomUUID(), fullName: 'test/history' } })
    repositoryId = repository.id
  })
  beforeEach(async () => {
    source.next.mockReset()
    await prisma.event.deleteMany({ where: { repositoryId } })
    await prisma.gitIdentity.deleteMany({ where: { repositoryId } })
    await prisma.recalculationRequest.deleteMany({ where: { teamId } })
    await prisma.repository.update({ where: { id: repositoryId }, data: { syncStatus: 'pending', syncCursor: null,
      syncRetryAt: null, syncLeaseToken: null, syncLeaseUntil: null, syncFailures: 0, syncProcessed: 0,
      syncError: null, nextReconcileAt: null } })
  })
  afterAll(async () => {
    if (prisma) {
      if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } })
      await prisma.user.deleteMany({ where: { id: { in: Object.values(accounts).map(a => a.id) } } })
    }
    if (app) await app.close()
    process.env = { ...oldEnv }
  })

  it('resumes a committed cursor in a new worker, enriches without mutating raw data, and deduplicates replay', async () => {
    await save([event()])
    const cursor = { stage: 'issues', anchor, page: 2 }
    source.next.mockResolvedValueOnce({ cursor, events: [] })
    expect(await history.step(repositoryId)).toBe(true)
    expect(JSON.parse((await prisma.repository.findUniqueOrThrow({ where: { id: repositoryId } })).syncCursor!)).toEqual(cursor)
    source.next.mockRejectedValueOnce(new Error('temporary network error with private details'))
    const restarted = new HistoryService(prisma, source as unknown as HistorySource, store)
    expect(await restarted.step(repositoryId)).toBe(false)
    let repository = await prisma.repository.findUniqueOrThrow({ where: { id: repositoryId } })
    expect(repository.syncError).toBe('HISTORY_REQUEST_FAILED')
    expect(repository.syncCursor).toBe(JSON.stringify(cursor))
    expect(await restarted.step(repositoryId)).toBe(false)
    expect(source.next).toHaveBeenCalledTimes(2)
    await prisma.repository.update({ where: { id: repositoryId }, data: { syncRetryAt: new Date(0) } })
    source.next.mockResolvedValueOnce({ cursor: null, events: [{ ...event(), payload: { title: 'Richer history title', url: 'https://example.com' },
      details: { stats: { additions: 10, deletions: 1, total: 11 }, files: [] } }] })
    expect(await restarted.step(repositoryId)).toBe(false)
    repository = await prisma.repository.findUniqueOrThrow({ where: { id: repositoryId } })
    expect(repository.syncStatus).toBe('complete')
    expect(repository.syncedAt?.toISOString()).toBe(anchor)
    const stored = await prisma.event.findFirstOrThrow({ where: { repositoryId }, include: { author: true } })
    expect(stored.payload).toMatchObject({ title: 'Original webhook title' })
    expect(stored.details).toMatchObject({ stats: { total: 11 } })
    expect(stored.author?.userId).toBe(accounts.member.id)
    const version = (await prisma.recalculationRequest.findFirstOrThrow({ where: { teamId } })).version
    await save([{ ...event(), details: { files: [], stats: { total: 11, deletions: 1, additions: 10 } } }])
    expect(await prisma.event.count({ where: { repositoryId } })).toBe(1)
    expect((await prisma.recalculationRequest.findFirstOrThrow({ where: { teamId } })).version).toBe(version)
  })

  it('waits for the rate-limit reset without losing progress or consuming the failure budget', async () => {
    const retryAt = new Date(Date.now() + 3600000)
    source.next.mockRejectedValueOnce(new GitHubRateLimit(retryAt))
    await history.step(repositoryId)
    const row = await prisma.repository.findUniqueOrThrow({ where: { id: repositoryId } })
    expect(row.syncStatus).toBe('pending'); expect(row.syncError).toBe('GITHUB_RATE_LIMIT')
    expect(row.syncRetryAt).toEqual(retryAt); expect(row.syncFailures).toBe(0)
    await history.step(repositoryId)
    expect(source.next).toHaveBeenCalledTimes(1)
  })

  it('stops after five consecutive failures and resumes the saved cursor on manual retry', async () => {
    const cursor = { stage: 'issues', anchor, page: 3 }
    await prisma.repository.update({ where: { id: repositoryId }, data: { syncCursor: JSON.stringify(cursor), syncProcessed: 12 } })
    source.next.mockRejectedValue(new Error('Persistent upstream failure'))
    for (let i = 0; i < 5; i++) {
      await prisma.repository.update({ where: { id: repositoryId }, data: { syncRetryAt: new Date(0) } })
      await history.step(repositoryId)
    }
    expect((await prisma.repository.findUniqueOrThrow({ where: { id: repositoryId } })).syncStatus).toBe('failed')
    await history.request(teamId)
    const resumed = await prisma.repository.findUniqueOrThrow({ where: { id: repositoryId } })
    expect(resumed.syncStatus).toBe('pending'); expect(resumed.syncCursor).toBe(JSON.stringify(cursor))
    expect(resumed.syncProcessed).toBe(12); expect(resumed.syncFailures).toBe(0)
  })

  it('recovers expired leases but never commits after disconnection', async () => {
    await prisma.repository.update({ where: { id: repositoryId }, data: {
      syncStatus: 'running', syncLeaseUntil: new Date(0), syncLeaseToken: 'dead-worker',
    } })
    source.next.mockImplementationOnce(async () => {
      await prisma.repository.update({ where: { id: repositoryId }, data: { syncStatus: 'disconnected' } })
      return { cursor: null, events: [event()] }
    })
    expect(await history.step(repositoryId)).toBe(false)
    expect(await prisma.event.count({ where: { repositoryId } })).toBe(0)
    expect((await prisma.repository.findUniqueOrThrow({ where: { id: repositoryId } })).syncStatus).toBe('disconnected')
  })

  it('schedules daily reconciliation and exposes safe status only to the right team', async () => {
    await prisma.repository.update({ where: { id: repositoryId }, data: { syncStatus: 'complete', nextReconcileAt: new Date(0) } })
    await history.reconcileDue()
    expect((await prisma.repository.findUniqueOrThrow({ where: { id: repositoryId } })).syncStatus).toBe('pending')
    const status = await api().get(`/api/teams/${teamId}/repository/sync`).set(headers('member')).expect(200)
    expect(status.body).not.toHaveProperty('syncCursor')
    await api().get(`/api/teams/${teamId}/repository/sync`).set(headers('stranger')).expect(404)
    await api().post(`/api/teams/${teamId}/repository/sync`).set(headers('observer')).expect(403)
    await api().post(`/api/teams/${teamId}/repository/sync`).set(headers('member')).expect(201)
    await api().post(`/api/teams/${teamId}/repository/sync`).set(headers('manager')).expect(201)
  })

  it('prioritizes numeric GitHub identity over a conflicting verified email', async () => {
    await save([event('a', 'member@example.com', accounts.second.githubId)])
    const identity = await prisma.gitIdentity.findFirstOrThrow({ where: { repositoryId } })
    expect(identity.userId).toBe(accounts.second.id); expect(identity.resolution).toBe('github')
    await api().post(`/api/teams/${teamId}/identities/${identity.id}/claim`).set(headers('member')).expect(409)
  })

  it('allows only a participant to claim an unknown author, audits once and invalidates each affected week', async () => {
    await save([event('a', 'unknown@example.com'), { ...event('b', 'unknown@example.com'), occurredAt: '2026-11-25T12:00:00Z' }])
    const identity = await prisma.gitIdentity.findFirstOrThrow({ where: { repositoryId } })
    const path = `/api/teams/${teamId}/identities/${identity.id}/claim`
    await api().post(path).set(headers('observer')).expect(403)
    await api().post(path).set(headers('stranger')).expect(403)
    await api().post(path).set(headers('manager')).expect(403)
    await api().post(`/api/teams/${teamId}/identities/${randomUUID()}/claim`).set(headers('member')).expect(404)
    await api().post(path).set(headers('member')).expect(201)
    await api().post(path).set(headers('member')).expect(201)
    expect(await prisma.identityResolution.count({ where: { identityId: identity.id, reason: 'claimed' } })).toBe(1)
    const weeks = await prisma.recalculationRequest.findMany({ where: { teamId } })
    expect(weeks).toHaveLength(2); expect(weeks.every(w => w.version === 2)).toBe(true)
    expect((await api().get(`/api/teams/${teamId}/identities/unmatched`).set(headers('member')).expect(200)).body.identities).toHaveLength(0)
  })

  it('prevents conflicting concurrent claims and blocks another team', async () => {
    await save([event('a', 'unknown@example.com')])
    const identity = await prisma.gitIdentity.findFirstOrThrow({ where: { repositoryId } })
    const path = `/api/teams/${teamId}/identities/${identity.id}/claim`
    const results = await Promise.all(['member', 'second'].map(name => api().post(path).set(headers(name))))
    expect(results.map(r => r.status).sort()).toEqual([201, 409])
    await api().get(`/api/teams/${otherTeamId}/events`).set(headers('member')).expect(404)
    await api().get(`/api/teams/${teamId}/events?cursor=not-a-uuid`).set(headers('member')).expect(400)
    expect((await api().get(`/api/teams/${teamId}/events`).set(headers('member')).expect(200)).body.events).toHaveLength(1)
  })

  it('corrects a self-claim if richer GitHub data identifies a different author', async () => {
    await save([event('a', 'unknown@example.com')])
    const identity = await prisma.gitIdentity.findFirstOrThrow({ where: { repositoryId } })
    await api().post(`/api/teams/${teamId}/identities/${identity.id}/claim`).set(headers('member')).expect(201)
    await save([event('a', 'unknown@example.com', accounts.second.githubId)])
    expect((await prisma.gitIdentity.findUniqueOrThrow({ where: { id: identity.id } })).userId).toBe(accounts.second.id)
    expect(await prisma.identityResolution.count({ where: { identityId: identity.id } })).toBe(2)
  })

  it('rematches enriched history when a participant joins later', async () => {
    await prisma.teamMembership.delete({ where: { teamId_userId: { teamId, userId: accounts.member.id } } })
    await save([{ ...event(), details: { stats: { total: 1 } } }])
    expect((await prisma.gitIdentity.findFirstOrThrow({ where: { repositoryId } })).userId).toBeNull()
    await prisma.teamMembership.create({ data: { teamId, projectId, userId: accounts.member.id } })
    await prisma.$transaction(async tx => store.rematch(tx, await tx.repository.findUniqueOrThrow({ where: { id: repositoryId } })))
    expect((await prisma.gitIdentity.findFirstOrThrow({ where: { repositoryId } })).userId).toBe(accounts.member.id)
  })

  it('runs history jobs through the real BullMQ dispatcher', async () => {
    source.next.mockResolvedValue({ cursor: null, events: [event()] })
    process.env.GITHUB_EVENTS_ENABLED = 'true'; process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15'
    process.env.GITHUB_QUEUE_NAME = `history-test-${randomUUID()}`
    const queue = new EventsQueue(prisma, app.get(DeliveryProcessor), history)
    queue.onModuleInit()
    try {
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        if ((await prisma.repository.findUniqueOrThrow({ where: { id: repositoryId } })).syncStatus === 'complete') break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      expect((await prisma.repository.findUniqueOrThrow({ where: { id: repositoryId } })).syncStatus).toBe('complete')
      expect(await prisma.event.count({ where: { repositoryId } })).toBe(1)
    } finally { await queue.onModuleDestroy(); process.env.GITHUB_EVENTS_ENABLED = 'false' }
  })
})
