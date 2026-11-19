// Complete deployment rehearsal in a dedicated Compose project, without real OAuth/App credentials.
const fs = require('node:fs/promises')
const path = require('node:path')
const net = require('node:net')
const assert = require('node:assert/strict')
const { randomBytes, randomUUID } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { backup, verify, run } = require('./backup.cjs')
async function port() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const value = server.address().port
  await new Promise(resolve => server.close(resolve))
  return value
}
async function main() {
  const root = path.resolve(__dirname, '..'), id = randomUUID().slice(0, 8)
  const project = `teampulse-deploy-check-${id}`, dir = path.join(__dirname, 'local', project)
  await fs.mkdir(dir, { recursive: true })
  const envFile = path.join(dir, '.env'), key = path.join(dir, 'empty.key')
  const password = randomBytes(24).toString('hex'), http = await port(), https = await port()
  // Empty fixture only: allow the non-root API UID to read this bind-mounted test file on Linux CI.
  await fs.writeFile(key, '', { mode: 0o444 })
  await fs.writeFile(envFile, [
    `API_ENV_FILE=${envFile.replaceAll('\\', '/')}`, 'TEAMPULSE_IMAGE_TAG=check', 'POSTGRES_DB=teampulse', 'POSTGRES_USER=teampulse',
    `POSTGRES_PASSWORD=${password}`, `DATABASE_URL=postgresql://teampulse:${password}@postgres:5432/teampulse?schema=public`,
    'REDIS_URL=redis://redis:6379', 'SITE_ADDRESS=http://:80', 'WEB_ORIGIN=https://localhost.test', 'HTTP_BIND=127.0.0.1',
    `HTTP_PORT=${http}`, `HTTPS_PORT=${https}`, `GITHUB_APP_PRIVATE_KEY_FILE=${key.replaceAll('\\', '/')}`, 'GITHUB_EVENTS_ENABLED=true',
  ].join('\n') + '\n', { mode: 0o600 })
  const compose = path.join(__dirname, 'compose.yaml')
  const args = ['compose', '--project-name', project, '--env-file', envFile, '--file', compose]
  let started = false
  try {
    started = true
    const up = spawnSync('docker', [...args, 'up', '--build', '-d', '--wait', '--wait-timeout', '180'], { cwd: root, stdio: 'inherit' })
    if (up.status !== 0) throw new Error('Deployment containers failed to start')
    const base = `http://127.0.0.1:${http}`
    assert.equal((await fetch(base + '/')).status, 200)
    assert.match(await (await fetch(base + '/projects/test')).text(), /<div id="root">/)
    const health = await fetch(base + '/api/health/ready')
    assert.deepEqual(await health.json(), { status: 'ok', database: 'up', redis: 'up' })
    await run('docker', [...args, 'exec', '-T', 'api', 'node', '-e',
      "require('node:fs').accessSync(process.env.GITHUB_APP_PRIVATE_KEY_PATH, require('node:fs').constants.R_OK)"])
    const protectedResponse = await fetch(base + '/api/workspace')
    assert.equal(protectedResponse.status, 401)
    assert.match(protectedResponse.headers.get('content-type'), /application\/json/)
    const missing = await fetch(base + '/api/does-not-exist')
    assert.notEqual(missing.status, 200) // API misses must never fall back to the SPA.
    const services = await run('docker', [...args, 'ps', '--format', 'json'])
    for (const row of services.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))) {
      if (['postgres', 'redis', 'api'].includes(row.Service)) assert.equal(row.Publishers?.filter(port => port.PublishedPort > 0).length ?? 0, 0)
    }
    await run('docker', [...args, 'exec', '-T', 'postgres', 'psql', '-U', 'teampulse', '-d', 'teampulse', '-v', 'ON_ERROR_STOP=1', '-c',
      'INSERT INTO "Organization" (id,name,kind) VALUES (gen_random_uuid(),\'Deployment restore fixture\',\'university\');'])
    const file = await backup({ compose, project, envFile, directory: path.join(dir, 'backups') })
    const restored = await verify(file)
    assert.equal(restored.organizations, 1)
    const migrations = (await fs.readdir(path.join(root, 'apps/api/prisma/migrations'), { withFileTypes: true })).filter(entry => entry.isDirectory()).length
    assert.equal(restored.migrations, migrations)
    console.log('Deployment check passed: production images, proxy, private DB/Redis/API, migrations, binary backup and isolated restore.')
  } finally {
    if (started) {
      const down = spawnSync('docker', [...args, 'down', '--volumes', '--remove-orphans'], { cwd: root, stdio: 'inherit' })
      if (down.status !== 0) throw new Error(`Cleanup incomplete for disposable project ${project}`)
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
