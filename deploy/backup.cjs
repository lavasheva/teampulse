// Binary-safe PostgreSQL backups on Windows and Linux. Never restores over the source DB.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
const { pipeline } = require('node:stream/promises')

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', error = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { error += chunk })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(error.trim() || `${command} exited ${code}`)))
  })
}
async function digest(file) {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
async function backup({ compose, project, envFile, directory }) {
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 })
  const file = path.resolve(directory, `teampulse-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.dump`)
  const partial = file + '.partial'
  const args = ['compose', '--project-name', project, '--file', compose,
    ...(envFile ? ['--env-file', envFile] : []), 'exec', '-T', 'postgres', 'sh', '-c',
    'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl']
  const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let error = ''
  child.stderr.on('data', chunk => { error += chunk })
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(error.trim() || `pg_dump exited ${code}`)))
  })
  try {
    await Promise.all([pipeline(child.stdout, fs.createWriteStream(partial, { flags: 'wx', mode: 0o600 })), completion])
    if ((await fsp.stat(partial)).size < 5) throw new Error('Empty backup')
    await fsp.rename(partial, file)
    await fsp.writeFile(file + '.sha256', await digest(file) + '\n', { flag: 'wx', mode: 0o600 })
    return file
  } catch (error) {
    child.kill()
    await fsp.unlink(partial).catch(() => {})
    throw error
  }
}
async function verify(file) {
  file = path.resolve(file)
  const expected = (await fsp.readFile(file + '.sha256', 'utf8')).trim()
  if (!/^[a-f0-9]{64}$/.test(expected) || await digest(file) !== expected) throw new Error('Backup checksum mismatch')
  const name = `teampulse-restore-check-${randomUUID()}`
  let created = false
  try {
    await run('docker', ['run', '-d', '--name', name, '--network', 'none', '--label', 'teampulse.restore-check=true',
      '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine'])
    created = true
    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      try { await run('docker', ['exec', name, 'pg_isready', '-U', 'postgres']); ready = true; break }
      catch { await new Promise(resolve => setTimeout(resolve, 1000)) }
    }
    if (!ready) throw new Error('Temporary PostgreSQL did not start')
    await run('docker', ['cp', file, `${name}:/tmp/backup.dump`])
    await run('docker', ['exec', name, 'createdb', '-U', 'postgres', 'teampulse_restore_test'])
    await run('docker', ['exec', name, 'pg_restore', '-U', 'postgres', '-d', 'teampulse_restore_test',
      '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '/tmp/backup.dump'])
    const result = await run('docker', ['exec', name, 'psql', '-U', 'postgres', '-d', 'teampulse_restore_test', '-At', '-v', 'ON_ERROR_STOP=1', '-c',
      'SELECT json_build_object(\'migrations\',(SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),\'organizations\',(SELECT count(*) FROM "Organization"),\'users\',(SELECT count(*) FROM "User"),\'events\',(SELECT count(*) FROM "Event"));'])
    return JSON.parse(result)
  } finally {
    if (created) {
      // Remove only the exact isolated container this invocation created; never touch source volumes.
      const label = await run('docker', ['inspect', '--format', '{{index .Config.Labels "teampulse.restore-check"}}', name])
      if (label !== 'true' || !/^teampulse-restore-check-[a-f0-9-]+$/.test(name)) throw new Error('Unexpected restore container')
      await run('docker', ['rm', '-f', '-v', name])
    }
  }
}
module.exports = { backup, verify, run }
if (require.main === module) {
  const [command, ...args] = process.argv.slice(2)
  const options = Object.fromEntries(args.map(arg => { const at = arg.indexOf('='); if (!arg.startsWith('--') || at < 3) throw new Error('Use --name=value arguments'); return [arg.slice(2, at), arg.slice(at + 1)] }))
  const task = command === 'backup' && options.project
    ? backup({ compose: path.resolve(options.compose || 'deploy/compose.yaml'), project: options.project,
      envFile: options.env ? path.resolve(options.env) : undefined, directory: path.resolve(options.out || 'backups') })
    : command === 'verify' && options.archive ? verify(options.archive) : Promise.reject(new Error(
      'Usage: node deploy/backup.cjs backup --project=NAME [--compose=FILE] [--env=FILE] [--out=DIR]\n       node deploy/backup.cjs verify --archive=FILE'))
  task.then(result => console.log(typeof result === 'string' ? result : JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1 })
}
