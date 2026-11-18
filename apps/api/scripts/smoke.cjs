// Run after build + db:deploy against a local PostgreSQL database.
const assert = require('node:assert/strict')

async function main() {
  // Port 0 lets the OS choose a free port for the real application module.
  const { NestFactory } = require('@nestjs/core')
  const { AppModule } = require('../dist/app.module')
  const { configureApp } = require('../dist/setup')
  const config = require('../dist/config').readConfig()
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false })
  try {
    configureApp(app)
    await app.listen(0, '127.0.0.1')
    const base = await app.getUrl()
    const live = await fetch(`${base}/api/health/live`)
    assert.equal(live.status, 200)
    assert.deepEqual(await live.json(), { status: 'ok' })
    const ready = await fetch(`${base}/api/health/ready`, {
      headers: { Origin: config.origin },
    })
    assert.equal(ready.status, 200)
    assert.deepEqual(await ready.json(), { status: 'ok', database: 'up' })
    assert.equal(ready.headers.get('access-control-allow-origin'), config.origin)
    console.log('Smoke passed: real PostgreSQL connection, liveness, readiness, CORS.')
  } finally {
    await app.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
