import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { readConfig } from './config'

async function bootstrap() {
  const config = readConfig()
  const app = await NestFactory.create(AppModule)
  app.setGlobalPrefix('api')
  app.enableCors({ origin: config.origin, credentials: true })
  app.enableShutdownHooks()
  await app.listen(config.port, config.host)
}

void bootstrap().catch(() => {
  console.error('API startup failed. Check configuration and PostgreSQL availability.')
  process.exitCode = 1
})
