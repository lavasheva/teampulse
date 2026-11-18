import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import type { DeliveryPayload } from './normalize'

@Injectable()
export class DeliveryProcessor {
  constructor(private readonly prisma: PrismaService) {}

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
          if (repository) for (const event of data.events) {
            // Only immutable numeric GitHub identity can be matched now. Email claims are stage 4.
            const member = event.author.githubId ? await tx.user.findFirst({ where: {
              githubId: event.author.githubId, teams: { some: { teamId: repository.teamId } },
            } }) : null
            const author = await tx.gitIdentity.upsert({ where: { repositoryId_provider_authorKey: {
              repositoryId: repository.id, provider: 'github', authorKey: event.author.key } },
              create: { repositoryId: repository.id, authorKey: event.author.key,
                login: event.author.login, email: event.author.email, userId: member?.id },
              update: {} })
            await tx.event.upsert({ where: { repositoryId_externalId: {
              repositoryId: repository.id, externalId: event.externalId } }, update: {},
              create: { repositoryId: repository.id, externalId: event.externalId, kind: event.kind,
                authorId: author.id, occurredAt: new Date(event.occurredAt),
                payload: event.payload as unknown as Prisma.InputJsonValue } })
          }
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
