import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma.service'
import { EventStore } from './event.store'
import { GitHubAccessError, GitHubRateLimit, HistorySource, type HistoryCursor } from './history.source'

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService, private readonly source: HistorySource,
    private readonly events: EventStore) {}

  async request(teamId: string) {
    const repository = await this.prisma.repository.findUnique({ where: { teamId } })
    if (!repository) throw new NotFoundException('Repository not found')
    if (repository.syncStatus === 'disconnected') throw new ConflictException('Reconnect the GitHub App first')
    if (['pending', 'running'].includes(repository.syncStatus)) return { status: repository.syncStatus }
    const changed = await this.prisma.repository.updateMany({ where: { id: repository.id,
      syncStatus: { in: ['complete', 'failed'] } }, data: { syncStatus: 'pending',
      syncCursor: repository.syncStatus === 'failed' ? repository.syncCursor : null,
      syncProcessed: repository.syncStatus === 'failed' ? repository.syncProcessed : 0,
      syncFailures: 0, syncError: null, syncRetryAt: null, syncLeaseUntil: null, syncLeaseToken: null } })
    if (!changed.count) throw new ConflictException('Synchronization changed concurrently')
    return { status: 'pending' }
  }

  async reconcileDue() {
    await this.prisma.repository.updateMany({ where: { syncStatus: 'complete', nextReconcileAt: { lte: new Date() } },
      data: { syncStatus: 'pending', syncCursor: null, syncProcessed: 0, syncFailures: 0,
        syncRetryAt: null, syncError: null, syncLeaseToken: null, syncLeaseUntil: null } })
  }

  // A lease covers one bounded network request. Every committed step stores its next cursor.
  async step(id: string): Promise<boolean> {
    const now = new Date(), lease = randomUUID()
    const claimed = await this.prisma.repository.updateMany({ where: { id, syncStatus: { in: ['pending', 'running'] },
      AND: [{ OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lte: now } }] },
        { OR: [{ syncRetryAt: null }, { syncRetryAt: { lte: now } }] }] },
      data: { syncStatus: 'running', syncLeaseToken: lease, syncLeaseUntil: new Date(Date.now() + 120000) } })
    if (!claimed.count) return false
    const repository = await this.prisma.repository.findUniqueOrThrow({ where: { id } })
    try {
      const cursor: HistoryCursor = repository.syncCursor ? JSON.parse(repository.syncCursor)
        : { stage: 'repository', anchor: new Date().toISOString() }
      const result = await this.source.next(repository, cursor, async sha => {
        const event = await this.prisma.event.findUnique({ where: { repositoryId_externalId: {
          repositoryId: id, externalId: `commit:${sha}` } }, select: { details: true } })
        return Boolean(event?.details && typeof event.details === 'object' && 'stats' in event.details)
      })
      let more = false
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Repository" WHERE id = ${id}::uuid FOR UPDATE`
        const current = await tx.repository.findUniqueOrThrow({ where: { id } })
        if (current.syncLeaseToken !== lease || current.syncStatus === 'disconnected'
          || current.installationId !== repository.installationId) return
        await this.events.save(tx, current, result.events)
        const finished = result.cursor === null
        if (finished) await this.events.rematch(tx, current)
        await tx.repository.update({ where: { id }, data: {
          syncStatus: finished ? 'complete' : 'running', syncCursor: result.cursor ? JSON.stringify(result.cursor) : null,
          syncProcessed: { increment: result.events.length }, syncLeaseToken: null, syncLeaseUntil: null,
          syncFailures: 0, syncRetryAt: null, syncError: null, fullName: result.fullName ?? current.fullName,
          ...(finished ? { syncedAt: new Date(cursor.anchor), nextReconcileAt: new Date(Date.now() + 86400_000) } : {}),
        } })
        more = !finished
      }, { timeout: 60000 })
      return more
    } catch (error) {
      const limited = error instanceof GitHubRateLimit, denied = error instanceof GitHubAccessError
      const failures = repository.syncFailures + (limited ? 0 : 1)
      await this.prisma.repository.updateMany({ where: { id, syncLeaseToken: lease, syncStatus: 'running' }, data: {
        syncStatus: denied ? 'disconnected' : failures >= 5 ? 'failed' : 'pending', syncFailures: failures,
        syncError: denied ? 'GITHUB_ACCESS_DENIED' : limited ? 'GITHUB_RATE_LIMIT' : 'HISTORY_REQUEST_FAILED',
        ...(denied ? { connectionVersion: { increment: 1 }, nextReconcileAt: null } : {}),
        syncRetryAt: denied || failures >= 5 ? null : limited ? error.retryAt : new Date(Date.now() + Math.min(60000, 1000 * 2 ** failures)),
        syncLeaseToken: null, syncLeaseUntil: null,
      } })
      return false
    }
  }

  async run(id: string) {
    const deadline = Date.now() + 20000
    for (let steps = 0; steps < 20 && Date.now() < deadline; steps++) if (!await this.step(id)) break
  }
}
