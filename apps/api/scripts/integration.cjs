const { spawnSync } = require('node:child_process')
const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.endsWith('_test')) {
  console.error('TEST_DATABASE_URL must point to a dedicated database whose name ends in _test.')
  process.exit(1)
}
const env = { ...process.env, DATABASE_URL: url, GITHUB_EVENTS_ENABLED: 'false' }
for (const [file, args] of [
  [require.resolve('prisma/build/index.js'), ['migrate', 'deploy']],
  [require.resolve('jest/bin/jest'), ['--config', 'jest.integration.json', '--runInBand']],
]) {
  const result = spawnSync(process.execPath, [file, ...args], { env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
