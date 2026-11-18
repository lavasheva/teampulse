import { INestApplication, ValidationPipe } from '@nestjs/common'

export function configureApp(app: INestApplication) {
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
