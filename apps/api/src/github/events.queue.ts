import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common'
import { Queue, Worker } from 'bullmq'
import { PrismaService } from '../prisma.service'
import { DeliveryProcessor } from './delivery.processor'
import { Prisma } from '@prisma/client'
import { HistoryService } from './history.service'

export function redisConnection(value: string) {
  const url = new URL(value)
  if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('REDIS_URL must use redis or rediss')
  const db = Number(url.pathname.slice(1) || 0)
  if (!Number.isInteger(db) || db < 0) throw new Error('Invalid Redis database')
  return { host: url.hostname, port: Number(url.port || 6379), db,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}), maxRetriesPerRequest: null }
}

@Injectable()
export class EventsQueue implements OnModuleInit, OnModuleDestroy {
  private queue?: Queue
  private worker?: Worker
  private timer?: ReturnType<typeof setInterval>
  private busy = false
  private dispatching?: Promise<void>
  private readonly logger = new Logger(EventsQueue.name)

  constructor(private readonly prisma: PrismaService, private readonly processor: DeliveryProcessor,
    @Optional() private readonly history?: HistoryService) {}

  onModuleInit() {
    if (process.env.GITHUB_EVENTS_ENABLED !== 'true') return
    if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required when GitHub events are enabled')
    const connection = redisConnection(process.env.REDIS_URL)
    const queueName = process.env.GITHUB_QUEUE_NAME ?? 'github-deliveries'
    this.queue = new Queue(queueName, { connection: { ...connection, maxRetriesPerRequest: 1, enableOfflineQueue: false } })
    this.worker = new Worker(queueName, job => job.name === 'sync-history' && this.history
      ? this.history.run(String(job.data.repositoryId)) : this.processor.process(String(job.data.deliveryId)), {
      connection, concurrency: 1,
    })
    this.queue.on('error', () => { /* Pending PostgreSQL rows remain recoverable. */ })
    this.worker.on('error', () => { /* Redis reconnects; never log connection secrets. */ })
    this.timer = setInterval(() => this.schedule(), 3000)
    this.timer.unref()
    this.schedule()
  }

  private schedule() {
    if (this.busy) return
    this.busy = true
    this.dispatching = this.dispatch().catch(() => {
      this.logger.warn('GitHub queue unavailable; pending deliveries remain in PostgreSQL')
    }).finally(() => { this.busy = false })
  }

  async dispatch() {
    if (!this.queue) return
    const rows = await this.prisma.webhookDelivery.findMany({ where: { status: 'pending', payload: { not: Prisma.DbNull } },
      orderBy: { receivedAt: 'asc' }, take: 100, select: { id: true } })
    for (const row of rows) {
      // Removing a terminal Redis job is safe: DB status is the source of truth.
      const existing = await this.queue.getJob(row.id)
      if (existing && ['failed', 'completed'].includes(await existing.getState())) await existing.remove()
      await this.queue.add('process-delivery', { deliveryId: row.id }, { jobId: row.id,
        attempts: 5, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true, removeOnFail: false })
    }
    if (!this.history) return
    await this.history.reconcileDue()
    const repositories = await this.prisma.repository.findMany({ where: { syncStatus: { in: ['pending', 'running'] },
      AND: [{ OR: [{ syncRetryAt: null }, { syncRetryAt: { lte: new Date() } }] },
        { OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lte: new Date() } }] }] },
      take: 100, select: { id: true } })
    for (const repository of repositories) {
      const id = `history-${repository.id}`, existing = await this.queue.getJob(id)
      if (existing && ['completed', 'failed'].includes(await existing.getState())) await existing.remove()
      await this.queue.add('sync-history', { repositoryId: repository.id }, {
        jobId: id, removeOnComplete: true, removeOnFail: false,
      })
    }
  }

  async readiness() {
    if (!this.queue) return 'disabled'
    // Bound readiness even while Redis reconnects.
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([this.queue.getJobCounts('waiting'), new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Redis unavailable')), 1500)
      })])
      return 'up'
    } finally { if (timeout) clearTimeout(timeout) }
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
    await this.worker?.close(true)
    // Closing the clients also releases dispatch calls blocked on an offline Redis.
    await this.queue?.close()
  }
}
