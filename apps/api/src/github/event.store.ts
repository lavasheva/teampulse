import { Injectable } from '@nestjs/common'
import type { Prisma, Repository } from '@prisma/client'
import type { NormalizedEvent } from './normalize'
import { isDeepStrictEqual } from 'node:util'

export function weekStart(date: Date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7)
  return day
}

export async function invalidateWeeks(tx: Prisma.TransactionClient, teamId: string, dates: Date[]) {
  const weeks = new Map(dates.map(date => { const week = weekStart(date); return [week.toISOString(), week] }))
  for (const weekStartsOn of weeks.values()) await tx.recalculationRequest.upsert({
    where: { teamId_weekStartsOn: { teamId, weekStartsOn } },
    create: { teamId, weekStartsOn }, update: { version: { increment: 1 }, requestedAt: new Date() },
  })
}

export interface CollectedEvent extends NormalizedEvent { details?: Prisma.InputJsonValue }

@Injectable()
export class EventStore {
  async rematch(tx: Prisma.TransactionClient, repository: Repository) {
    const identities = await tx.gitIdentity.findMany({ where: { repositoryId: repository.id },
      include: { events: { take: 1, orderBy: { id: 'asc' } } } })
    for (const identity of identities) {
      const event = identity.events[0]
      if (!event) continue
      await this.save(tx, repository, [{ externalId: event.externalId, kind: event.kind,
        occurredAt: event.occurredAt.toISOString(), payload: event.payload as unknown as NormalizedEvent['payload'],
        author: { key: identity.authorKey, githubId: identity.githubId, login: identity.login, email: identity.email } }])
    }
  }

  async save(tx: Prisma.TransactionClient, repository: Repository, events: CollectedEvent[]) {
    const touched: Date[] = []
    for (const event of events) {
      const existing = await tx.event.findUnique({ where: { repositoryId_externalId: {
        repositoryId: repository.id, externalId: event.externalId } }, include: { author: true } })
      // Preserve the original event's author identity even if REST provides a richer identifier.
      const identity = existing?.author ?? await tx.gitIdentity.upsert({
        where: { repositoryId_provider_authorKey: { repositoryId: repository.id, provider: 'github', authorKey: event.author.key } },
        create: { repositoryId: repository.id, authorKey: event.author.key, email: event.author.email,
          login: event.author.login, githubId: event.author.githubId }, update: {},
      })
      await tx.$queryRaw`SELECT id FROM "GitIdentity" WHERE id = ${identity.id}::uuid FOR UPDATE`
      const current = await tx.gitIdentity.findUniqueOrThrow({ where: { id: identity.id } })
      const githubId = event.author.githubId ?? current.githubId
      const email = event.author.email ?? current.email
      const candidates = await tx.user.findMany({ where: {
        teams: { some: { teamId: repository.teamId, role: 'participant' } },
        ...(githubId ? { githubId } : email ? { verifiedEmails: { has: email.toLowerCase() } } : { githubId: '__none__' }),
      }, take: 2 })
      const candidate = candidates.length === 1 ? candidates[0] : null
      // Platform identity wins over self-claims; an unresolved email may retain a manual confirmation.
      const userId = candidate?.id ?? (githubId ? null : current.resolution === 'claimed' ? current.userId : null)
      const resolution = candidate ? githubId ? 'github' : 'verified_email' : userId ? 'claimed' : 'unresolved'
      await tx.gitIdentity.update({ where: { id: identity.id }, data: {
        githubId, email, login: event.author.login ?? current.login, userId, resolution,
      } })
      if (current.userId !== userId) {
        await tx.identityResolution.create({ data: { identityId: identity.id, fromUserId: current.userId,
          toUserId: userId, reason: resolution } })
        const prior = await tx.event.findMany({ where: { authorId: identity.id }, select: { occurredAt: true } })
        touched.push(...prior.map(row => row.occurredAt))
      }
      if (!existing) {
        await tx.event.create({ data: { repositoryId: repository.id, externalId: event.externalId,
          kind: event.kind, authorId: identity.id, occurredAt: new Date(event.occurredAt),
          payload: event.payload as unknown as Prisma.InputJsonValue, details: event.details } })
        touched.push(new Date(event.occurredAt))
      } else if (event.details && !isDeepStrictEqual(existing.details, event.details)) {
        // Raw event payload stays immutable; statistics are an independent enrichment.
        await tx.event.update({ where: { id: existing.id }, data: { details: event.details } })
        touched.push(existing.occurredAt)
      }
    }
    await invalidateWeeks(tx, repository.teamId, touched)
  }
}
