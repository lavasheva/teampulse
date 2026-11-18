// Test-only OAuth/GitHub stand-ins. Real HTTP guards, sessions, Prisma and event processing.
const { spawnSync } = require('node:child_process')
const { randomUUID, createHash, createHmac } = require('node:crypto')
const path = require('node:path')
process.chdir(path.resolve(__dirname, '..'))
const database = process.env.TEST_DATABASE_URL
if (process.env.NODE_ENV !== 'test' || !database || !new URL(database).pathname.endsWith('_test')) {
  throw new Error('E2E server requires NODE_ENV=test and a dedicated TEST_DATABASE_URL ending in _test')
}
Object.assign(process.env, { DATABASE_URL: database, GITHUB_EVENTS_ENABLED: 'false',
  WEB_ORIGIN: 'http://127.0.0.1:4174', GITHUB_WEBHOOK_SECRET: 'e2e-webhook-secret-'.repeat(4) })
const migrated = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], { stdio: 'inherit', env: process.env })
if (migrated.status !== 0) process.exit(migrated.status ?? 1)

async function start() {
  require('reflect-metadata')
  const { Test } = require('@nestjs/testing')
  const { AppModule } = require('../dist/app.module')
  const { GitHubClient } = require('../dist/auth/github.client')
  const { GitHubAppClient } = require('../dist/github/app.client')
  const { PrismaService } = require('../dist/prisma.service')
  const { DeliveryProcessor } = require('../dist/github/delivery.processor')
  const { configureApp } = require('../dist/setup')
  const { ForbiddenException } = require('@nestjs/common')
  const runId = randomUUID(), externalId = String(Date.now()), userIds = new Set()
  const teacherId = `e2e-teacher-${runId}`
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GitHubClient).useValue({
      authorizationUrl(state) { return `http://127.0.0.1:3010/__test/authorize?state=${encodeURIComponent(state)}` },
      async profile(code) {
        if (!['teacher', 'student'].includes(code)) throw new Error('Unknown test identity')
        return { githubId: code === 'teacher' ? teacherId : `e2e-student-${runId}`, githubLogin: `e2e-${code}-${runId.slice(0, 8)}`,
          name: code === 'teacher' ? 'Руководитель API' : 'Студент API', avatarUrl: null,
          email: `${code}@example.test`, verifiedEmails: [`${code}@example.test`] }
      },
    })
    .overrideProvider(GitHubAppClient).useValue({
      async findInstallation() { return '12345' },
      async verifyRepository(_installation, fullName, githubId) {
        if (githubId !== teacherId) throw new ForbiddenException('Test repository administrator required')
        return { externalId, fullName }
      },
    }).compile()
  const app = module.createNestApplication(), prisma = app.get(PrismaService)
  configureApp(app)
  const server = app.getHttpAdapter().getInstance()
  server.get('/__test/authorize', (req, res) => {
    const state = req.query.state
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) return res.sendStatus(400)
    res.type('html').send(`<html><head><meta charset="utf-8"></head><body><h1>Тестовый GitHub</h1>
      <a href="/api/auth/github/callback?state=${state}&code=teacher">Войти как руководитель</a><br>
      <a href="/api/auth/github/callback?state=${state}&code=student">Войти как студент</a></body></html>`)
  })
  server.post('/__test/emit', async (_req, res) => {
    try {
      const repository = await prisma.repository.findUniqueOrThrow({ where: { provider_externalId: { provider: 'github', externalId } } })
      const id = randomUUID(), sha = createHash('sha1').update(runId).digest('hex')
      const body = JSON.stringify({ installation: { id: 12345 }, repository: { id: Number(externalId) },
        commits: [{ id: sha, message: 'Событие из тестового GitHub', timestamp: new Date().toISOString(),
          url: 'https://github.com/test/repo/commit/' + sha, author: { email: 'unknown@example.test', username: 'unknown-author' },
          modified: ['src/app.ts'] }] })
      const response = await fetch('http://127.0.0.1:3010/api/webhooks/github', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-GitHub-Delivery': id, 'X-GitHub-Event': 'push',
          'X-Hub-Signature-256': 'sha256=' + createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET).update(body).digest('hex') }, body })
      if (response.status !== 202) throw new Error('Test webhook rejected')
      await app.get(DeliveryProcessor).process(id)
      await prisma.repository.update({ where: { id: repository.id }, data: { syncStatus: 'complete', syncedAt: new Date() } })
      res.json({ accepted: true })
    } catch { res.status(500).json({ error: 'Test event failed' }) }
  })
  async function cleanup() {
    const users = await prisma.user.findMany({ where: { githubId: { in: [teacherId, `e2e-student-${runId}`] } }, select: { id: true } })
    users.forEach(user => userIds.add(user.id))
    await prisma.organization.deleteMany({ where: { memberships: { some: { userId: { in: [...userIds] } } } } })
    await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } })
  }
  server.post('/__test/cleanup', async (_req, res) => { await cleanup(); res.json({ cleaned: true }) })
  await app.listen(3010, '127.0.0.1')
  let stopping = false
  const stop = async () => { if (stopping) return; stopping = true; await cleanup(); await app.close(); process.exit(0) }
  process.once('SIGTERM', () => void stop()); process.once('SIGINT', () => void stop())
}
start().catch(() => { console.error('E2E API startup failed'); process.exitCode = 1 })
