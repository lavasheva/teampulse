import { BadRequestException, ConflictException, Controller, HttpCode, Post, Req,
  ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { Request } from 'express'
import { Prisma } from '@prisma/client'
import { Public } from '../auth/security'
import { PrismaService } from '../prisma.service'
import { normalize } from './normalize'

@Controller('webhooks/github')
export class WebhooksController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Post()
  @HttpCode(202)
  async accept(@Req() req: Request) {
    const secret = process.env.GITHUB_WEBHOOK_SECRET
    if (!secret || secret.length < 32) throw new ServiceUnavailableException('Webhook secret is not configured')
    const signature = req.get('X-Hub-Signature-256') ?? ''
    if (!Buffer.isBuffer(req.body) || !/^sha256=[a-f0-9]{64}$/.test(signature)) throw new UnauthorizedException('Invalid webhook signature')
    const expected = createHmac('sha256', secret).update(req.body).digest()
    if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) throw new UnauthorizedException('Invalid webhook signature')
    const deliveryId = req.get('X-GitHub-Delivery') ?? '', event = req.get('X-GitHub-Event') ?? ''
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(deliveryId)
      || !/^[a-z_]{1,80}$/.test(event)) throw new BadRequestException('Invalid webhook headers')
    const contentHash = createHash('sha256').update(event).update('\0').update(req.body).digest('hex')
    const previous = await this.prisma.webhookDelivery.findUnique({ where: { id: deliveryId } })
    if (previous) {
      if (previous.contentHash !== contentHash) throw new ConflictException('Delivery id reused with different content')
      return { accepted: true, duplicate: true }
    }
    let payload
    try { payload = normalize(event, JSON.parse(req.body.toString('utf8'))) }
    catch { throw new BadRequestException('Invalid GitHub payload') }
    if (!payload) return { accepted: false, ignored: true }
    const repository = payload.repositoryExternalId ? await this.prisma.repository.findFirst({ where: {
      provider: 'github', externalId: payload.repositoryExternalId, installationId: payload.installationId,
      syncStatus: { not: 'disconnected' },
    } }) : null
    if (payload.repositoryExternalId && !repository) return { accepted: false, ignored: true }
    if (!payload.repositoryExternalId && !await this.prisma.repository.count({ where: {
      installationId: payload.installationId, provider: 'github',
    } })) return { accepted: false, ignored: true }
    const connections = payload.disconnect ? await this.prisma.repository.findMany({ where: {
      provider: 'github', installationId: payload.installationId,
      ...(Array.isArray(payload.disconnect) ? { externalId: { in: payload.disconnect } } : {}),
    }, select: { id: true, connectionVersion: true } }) : undefined
    try {
      await this.prisma.webhookDelivery.create({ data: { id: deliveryId, eventName: event, contentHash,
        repositoryId: repository?.id, repositoryVersion: repository?.connectionVersion,
        payload: { ...payload, ...(connections ? { connections } : {}) } as unknown as Prisma.InputJsonValue } })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } })
        if (duplicate.contentHash !== contentHash) throw new ConflictException('Delivery id reused with different content')
        return { accepted: true, duplicate: true }
      }
      throw error
    }
    return { accepted: true, duplicate: false }
  }
}
