import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Queue, Worker } from 'bullmq'
import { analyticsEngine } from '@teampulse/analytics'
import { PrismaService } from '../prisma.service'
import { redisConnection } from '../github/events.queue'
import { AnalyticsService } from './analytics.service'

@Injectable()
export class AnalyticsQueue implements OnModuleInit, OnModuleDestroy {
  private queue?: Queue
  private worker?: Worker
  private timer?: ReturnType<typeof setInterval>
  private busy = false
  private cursor?: string
  constructor(private readonly prisma: PrismaService, private readonly analytics: AnalyticsService) {}
  onModuleInit() {
    if (process.env.GITHUB_EVENTS_ENABLED !== 'true' || process.env.ANALYTICS_ENABLED === 'false') return
    const connection = redisConnection(process.env.REDIS_URL!)
    const name = (process.env.GITHUB_QUEUE_NAME ?? 'github-deliveries') + '-analytics'
    this.queue = new Queue(name, { connection: { ...connection, maxRetriesPerRequest: 1, enableOfflineQueue: false } })
    this.worker = new Worker(name, job => this.analytics.run(String(job.data.teamId)), { connection, concurrency: 1 })
    this.queue.on('error', () => {}); this.worker.on('error', () => {})
    this.timer = setInterval(() => { if (!this.busy) { this.busy = true; void this.dispatch().catch(() => {}).finally(() => { this.busy = false }) } }, 3000)
    this.timer.unref()
  }
  async dispatch() {
    if (!this.queue) return
    const now = new Date()
    const teams = await this.prisma.team.findMany({ where: { repository: { syncStatus: 'complete' }, ...(this.cursor ? { id: { gt: this.cursor } } : {}) },
      orderBy: { id: 'asc' }, take: 50, include: { analysis: true } })
    this.cursor = teams.length === 50 ? teams.at(-1)!.id : undefined
    for (const team of teams) {
      const state = team.analysis
      if (state?.leaseUntil && state.leaseUntil > now) continue
      if (state && state.requestedVersion === team.analyticsVersion && state.engineVersion === analyticsEngine.version && state.nextAt > now) continue
      const id = `analytics-${team.id}`, job = await this.queue.getJob(id)
      if (job && ['completed', 'failed'].includes(await job.getState())) await job.remove()
      await this.queue.add('calculate', { teamId: team.id }, { jobId: id, removeOnComplete: true, removeOnFail: true })
    }
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
    await this.worker?.close(true); await this.queue?.close()
  }
}
