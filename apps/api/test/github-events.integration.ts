import 'reflect-metadata'
import { INestApplication, ForbiddenException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { createHmac, randomUUID } from 'node:crypto'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma.service'
import { configureApp } from '../src/setup'
import { csrfToken, hash, token } from '../src/auth/security'
import { GitHubAppClient } from '../src/github/app.client'
import { DeliveryProcessor } from '../src/github/delivery.processor'
import { EventsQueue } from '../src/github/events.queue'

describe('Signed GitHub deliveries on PostgreSQL and Redis', () => {
  const oldEnv = { ...process.env }, secret = 'test-webhook-secret-'.repeat(3)
  let app: INestApplication, prisma: PrismaService, processor: DeliveryProcessor, runtime: EventsQueue | undefined
  let orgId: string, projectId: string, teamId: string, otherTeamId: string, repositoryId: string
  let memberId: string, observerId: string, outsiderId: string
  const externalId = String(Math.floor(Math.random() * 1e12)), installationId = '12345'
  const values = { member: token(), observer: token(), outsider: token() }
  const deliveries: string[] = []
  const github = { verifyRepository: jest.fn() }
  const api = () => request(app.getHttpServer())
  const headers = (role: keyof typeof values) => ({ Cookie: `tp_session=${values[role]}`,
    Origin: 'http://localhost:5173', 'X-CSRF-Token': csrfToken(values[role]) })
  const payload = () => ({ repository: { id: Number(externalId) }, installation: { id: Number(installationId) },
    commits: [{ id: 'a'.repeat(40), message: 'Build feature', timestamp: '2026-11-18T12:00:00Z',
      url: 'https://github.com/test/repo/commit/a', author: { email: 'test@example.com', username: 'member' },
      modified: ['src/app.ts'], patch: 'SOURCE MUST NOT BE STORED' }] })
  function send(body: unknown, event = 'push', id = randomUUID(), signature?: string) {
    if (!deliveries.includes(id)) deliveries.push(id)
    const raw = typeof body === 'string' ? body : JSON.stringify(body)
    return api().post('/api/webhooks/github').set('Content-Type', 'application/json')
      .set('X-GitHub-Delivery', id).set('X-GitHub-Event', event)
      .set('X-Hub-Signature-256', signature ?? `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`).send(raw)
  }
  async function waitComplete(id: string) {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const row = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id } })
      if (row.status === 'complete') return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Delivery did not complete')
  }

  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test')) throw new Error('Dedicated test database required')
    process.env.GITHUB_EVENTS_ENABLED = 'false'
    process.env.GITHUB_WEBHOOK_SECRET = secret
    process.env.WEB_ORIGIN = 'http://localhost:5173'
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GitHubAppClient).useValue(github).compile()
    app = module.createNestApplication()
    configureApp(app)
    await app.init()
    prisma = app.get(PrismaService)
    processor = app.get(DeliveryProcessor)
    const ids: string[] = []
    for (const [name, value] of Object.entries(values)) {
      const user = await prisma.user.create({ data: { githubId: randomUUID(), githubLogin: name } })
      ids.push(user.id)
      await prisma.session.create({ data: { userId: user.id, tokenHash: hash(value), expiresAt: new Date(Date.now() + 3600_000) } })
    }
    ;[memberId, observerId, outsiderId] = ids
    const org = await prisma.organization.create({ data: { name: 'Webhook test', kind: 'school',
      projects: { create: { name: 'Webhook project', startsOn: new Date(), endsOn: new Date(), weights: {}, thresholds: {},
        teams: { create: [{ name: 'Own' }, { name: 'Other' }] } } } }, include: { projects: { include: { teams: true } } } })
    orgId = org.id; projectId = org.projects[0].id; teamId = org.projects[0].teams[0].id; otherTeamId = org.projects[0].teams[1].id
    await prisma.teamMembership.createMany({ data: [
      { userId: memberId, teamId, projectId, role: 'participant' },
      { userId: observerId, teamId, projectId, role: 'observer' },
    ] })
    github.verifyRepository.mockResolvedValue({ externalId, fullName: 'test/repo' })
  })

  afterAll(async () => {
    if (runtime) await runtime.onModuleDestroy()
    if (prisma) {
      await prisma.webhookDelivery.deleteMany({ where: { id: { in: deliveries } } })
      if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } })
      await prisma.user.deleteMany({ where: { id: { in: [memberId, observerId, outsiderId].filter(Boolean) } } })
    }
    if (app) await app.close()
    process.env = { ...oldEnv }
  })

  it('checks TeamPulse access and verified repository admin permission before binding', async () => {
    const body = { installationId, fullName: 'test/repo' }
    await api().post(`/api/teams/${teamId}/repository`).set(headers('observer')).send(body).expect(403)
    await api().post(`/api/teams/${teamId}/repository`).set(headers('outsider')).send(body).expect(404)
    github.verifyRepository.mockRejectedValueOnce(new ForbiddenException('Repository admin permission is required'))
    await api().post(`/api/teams/${teamId}/repository`).set(headers('member')).send(body).expect(403)
    const result = await api().post(`/api/teams/${teamId}/repository`).set(headers('member')).send(body).expect(201)
    repositoryId = result.body.id
    expect(github.verifyRepository.mock.calls.at(-1)[2]).toBe((await prisma.user.findUniqueOrThrow({ where: { id: memberId } })).githubId)
    github.verifyRepository.mockResolvedValueOnce({ externalId: `${externalId}1`, fullName: 'test/different' })
    await api().post(`/api/teams/${teamId}/repository`).set(headers('member')).send(body).expect(409)
  })

  it('verifies raw bytes before parsing and rejects oversized or malformed bodies', async () => {
    await send(payload(), 'push', randomUUID(), `sha256=${'0'.repeat(64)}`).expect(401)
    await send('{invalid-json', 'push', randomUUID(), `sha256=${'0'.repeat(64)}`).expect(401)
    await send('{invalid-json').expect(400)
    await send('x'.repeat(2 * 1024 * 1024 + 1)).expect(413)
  })

  it('persists an inbox row without Redis, strips source code and deduplicates delivery IDs', async () => {
    const id = randomUUID(), body = payload()
    await send(body, 'push', id).expect(202)
    const row = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id } })
    expect(row.status).toBe('pending')
    expect(JSON.stringify(row.payload)).not.toContain('SOURCE MUST NOT BE STORED')
    expect((await send(body, 'push', id).expect(202)).body.duplicate).toBe(true)
    await send({ ...body, extra: 'changed' }, 'push', id).expect(409)
    // Simulate a Redis transport outage: dispatch fails but does not alter the durable row.
    const unavailable = new EventsQueue(prisma, processor)
    Object.assign(unavailable, { queue: { getJob: async () => { throw new Error('Redis offline') } } })
    await expect(unavailable.dispatch()).rejects.toThrow('Redis offline')
    expect((await prisma.webhookDelivery.findUniqueOrThrow({ where: { id } })).status).toBe('pending')
    // Restore a real Redis queue/worker: PostgreSQL outbox is scanned automatically.
    process.env.GITHUB_EVENTS_ENABLED = 'true'
    process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15'
    process.env.GITHUB_QUEUE_NAME = `github-test-${randomUUID()}`
    runtime = new EventsQueue(prisma, processor)
    runtime.onModuleInit()
    await waitComplete(id)
    expect(await runtime.readiness()).toBe('up')
    expect(await prisma.event.count({ where: { repositoryId } })).toBe(1)
    await processor.process(id)
    const second = randomUUID()
    await send(body, 'push', second).expect(202)
    await processor.process(second)
    expect(await prisma.event.count({ where: { repositoryId } })).toBe(1)
    const identity = await prisma.gitIdentity.findFirstOrThrow({ where: { repositoryId } })
    expect(identity.userId).toBeNull()
  })

  it('ignores unknown repositories, installations and unsupported event types', async () => {
    expect((await send({ ...payload(), installation: { id: 99999 } }).expect(202)).body.ignored).toBe(true)
    expect((await send({ ...payload(), repository: { id: 99999 } }).expect(202)).body.ignored).toBe(true)
    expect((await send({}, 'ping').expect(202)).body.ignored).toBe(true)
  })

  it('records at most five processing failures with sanitized errors', async () => {
    await runtime?.onModuleDestroy(); runtime = undefined
    const id = randomUUID(); deliveries.push(id)
    await prisma.webhookDelivery.create({ data: { id, repositoryId, eventName: 'push',
      payload: { installationId, events: null } } })
    // Stop auto-dispatch before deliberately exercising permanent poison data.
    for (let i = 0; i < 5; i++) await expect(processor.process(id)).rejects.toThrow()
    const row = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id } })
    expect(row.attempts).toBe(5)
    expect(row.status).toBe('failed')
    expect(row.lastError).toBe('PROCESSING_FAILED')
    await processor.process(id)
    expect(await prisma.event.count({ where: { repositoryId } })).toBe(1)
  })

  it('disconnects installations and refuses to collect subsequent events', async () => {
    const id = randomUUID()
    await send({ action: 'deleted', installation: { id: Number(installationId) } }, 'installation', id).expect(202)
    await processor.process(id)
    expect((await prisma.repository.findUniqueOrThrow({ where: { id: repositoryId } })).syncStatus).toBe('disconnected')
    expect((await send(payload()).expect(202)).body.ignored).toBe(true)
  })
})
