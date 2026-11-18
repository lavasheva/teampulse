import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { PrismaService } from './prisma.service'
import { Public } from './auth/security'
import { EventsQueue } from './github/events.queue'

@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly queue: EventsQueue) {}

  @Get('live')
  live() { return { status: 'ok' } }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable', database: 'down' })
    }
    try {
      const redis = await this.queue.readiness()
      return redis === 'disabled' ? { status: 'ok', database: 'up' } : { status: 'ok', database: 'up', redis }
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable', database: 'up', redis: 'down' })
    }
  }
}
