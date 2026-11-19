import { INestApplication, ValidationPipe } from '@nestjs/common'
import { raw } from 'express'

export function configureApp(app: INestApplication) {
  // Enabled only for deployment behind the single private Caddy proxy.
  if (process.env.TRUST_PROXY_HOPS === '1') app.getHttpAdapter().getInstance().set('trust proxy', 1)
  // Register before Nest's JSON parser: signatures are checked against the original bytes.
  app.use('/api/webhooks/github', raw({ type: 'application/json', limit: '2mb' }))
  app.setGlobalPrefix('api')
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173', credentials: true })
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  // Authenticated responses and invitation tokens must not enter shared caches.
  app.use((_req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    next()
  })
}
