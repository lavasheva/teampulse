import 'reflect-metadata'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma.service'
import { EventsQueue } from '../src/github/events.queue'

describe('health HTTP endpoints', () => {
  let app: INestApplication
  const query = jest.fn()
  const readiness = jest.fn()

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue({ $queryRaw: query })
      .overrideProvider(EventsQueue).useValue({ readiness }).compile()
    app = module.createNestApplication()
    app.setGlobalPrefix('api')
    await app.init()
  })
  afterAll(async () => { await app.close() })
  beforeEach(() => { query.mockReset(); readiness.mockReset().mockResolvedValue('disabled') })

  it('liveness does not query PostgreSQL', async () => {
    await request(app.getHttpServer()).get('/api/health/live').expect(200, { status: 'ok' })
    expect(query).not.toHaveBeenCalled()
  })
  it('readiness checks PostgreSQL', async () => {
    query.mockResolvedValue([{ '?column?': 1 }])
    await request(app.getHttpServer()).get('/api/health/ready')
      .expect(200, { status: 'ok', database: 'up' })
    expect(query).toHaveBeenCalledTimes(1)
  })
  it('reports 503 without exposing database connection details', async () => {
    query.mockRejectedValue(new Error('postgresql://secret:password@private-host'))
    const response = await request(app.getHttpServer()).get('/api/health/ready').expect(503)
    expect(response.body).toEqual({ status: 'unavailable', database: 'down' })
  })
  it('checks Redis when the GitHub queue is enabled', async () => {
    query.mockResolvedValue([])
    readiness.mockResolvedValue('up')
    await request(app.getHttpServer()).get('/api/health/ready').expect(200, { status: 'ok', database: 'up', redis: 'up' })
  })
  it('distinguishes a Redis outage from a PostgreSQL outage', async () => {
    query.mockResolvedValue([])
    readiness.mockRejectedValue(new Error('private-redis-password'))
    await request(app.getHttpServer()).get('/api/health/ready')
      .expect(503, { status: 'unavailable', database: 'up', redis: 'down' })
  })
})
