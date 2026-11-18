import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import type { DeliveryPayload } from './normalize'
import { EventStore } from './event.store'

@Injectable()
export class DeliveryProcessor {
  constructor(private readonly prisma: PrismaService, private readonly events: EventStore) {}

  async process(id: string) {
    try {
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "WebhookDelivery" WHERE id = ${id} FOR UPDATE`
        const delivery = await tx.webhookDelivery.findUnique({ where: { id } })
        if (!delivery || delivery.status === 'complete' || delivery.status === 'failed') return
        const data = delivery.payload as unknown as DeliveryPayload | null
        if (!data) throw new Error('Missing normalized delivery')
        if (data.disconnect) {
          await tx.repository.updateMany({ where: { provider: 'github', installationId: data.installationId,
            ...(Array.isArray(data.disconnect) ? { externalId: { in: data.disconnect } } : {}) },
            data: { syncStatus: 'disconnected' } })
        } else if (delivery.repositoryId) {
          const repository = await tx.repository.findFirst({ where: { id: delivery.repositoryId,
            installationId: data.installationId, syncStatus: { not: 'disconnected' } } })
          if (repository) await this.events.save(tx, repository, data.events)
        }
        await tx.webhookDelivery.update({ where: { id }, data: {
          status: 'complete', processedAt: new Date(), attempts: { increment: 1 }, lastError: null } })
      }, { timeout: 60000 })
    } catch (error) {
      // Save only a generic error code: upstream bodies or database strings may contain secrets.
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "WebhookDelivery" WHERE id = ${id} FOR UPDATE`
        const row = await tx.webhookDelivery.findUnique({ where: { id } })
        if (row && row.status !== 'complete' && row.status !== 'failed') {
          await tx.webhookDelivery.update({ where: { id }, data: { attempts: { increment: 1 },
            status: row.attempts >= 4 ? 'failed' : 'pending', lastError: 'PROCESSING_FAILED' } })
        }
      }).catch(() => { /* The durable pending row will be retried after PostgreSQL recovers. */ })
      throw new Error('Delivery processing failed')
    }
  }
}
