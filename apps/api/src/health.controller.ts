import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { PrismaService } from './prisma.service'
import { Public } from './auth/security'

@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  live() { return { status: 'ok' } }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return { status: 'ok', database: 'up' }
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable', database: 'down' })
    }
  }
}
