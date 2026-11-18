export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT ?? 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }
  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl || !['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL')
  }
  const origin = env.WEB_ORIGIN ?? 'http://localhost:5173'
  const parsedOrigin = new URL(origin)
  if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin) {
    throw new Error('WEB_ORIGIN must be a single HTTP origin without a trailing slash')
  }
  return { port, host: env.HOST ?? '127.0.0.1', origin }
}
