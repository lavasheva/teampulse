import 'reflect-metadata'
import { Controller, Get, Req } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Request } from 'express'
import request from 'supertest'
import { configureApp } from '../src/setup'

@Controller('probe')
class ProbeController {
  @Get() ip(@Req() req: Request) { return { ip: req.ip } }
}
describe('explicit reverse proxy configuration', () => {
  const prior = process.env.TRUST_PROXY_HOPS
  afterEach(() => { if (prior === undefined) delete process.env.TRUST_PROXY_HOPS; else process.env.TRUST_PROXY_HOPS = prior })
  it.each([false, true])('trusts forwarded client IP only when enabled: %s', async enabled => {
    process.env.TRUST_PROXY_HOPS = enabled ? '1' : '0'
    const module = await Test.createTestingModule({ controllers: [ProbeController] }).compile()
    const app = module.createNestApplication()
    try {
      configureApp(app); await app.init()
      const response = await request(app.getHttpServer()).get('/api/probe').set('X-Forwarded-For', '203.0.113.42').expect(200)
      expect(response.body.ip === '203.0.113.42').toBe(enabled)
    } finally { await app.close() }
  }, 30000)
})
