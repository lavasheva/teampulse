import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { weekStart } from '../github/event.store'
import type { ProjectAnalyticsInput, WeeklyAnalyticsInput } from '@teampulse/shared'
import { z } from 'zod'

const weights = z.object({ code: z.number().int().min(0).max(100), pullRequests: z.number().int().min(0).max(100),
  reviews: z.number().int().min(0).max(100), issues: z.number().int().min(0).max(100) }).strict().refine(value => Object.values(value).reduce((a, b) => a + b, 0) === 100)
const thresholds = z.object({ inactivity: z.number().int().min(1).max(365), imbalance: z.number().int().min(1).max(100),
  lateBurst: z.number().int().min(1).max(100), excluded: z.number().int().min(1).max(100) }).strict()
const count = z.number().int().nonnegative()
const file = z.object({ filename: z.string(), status: z.string(), additions: count, deletions: count, changes: count, previousFilename: z.string().optional() })
const payload = z.object({ title: z.string(), url: z.string(), files: z.object({ added: z.array(z.string()), modified: z.array(z.string()), removed: z.array(z.string()) }).optional() })
const details = z.object({ stats: z.object({ additions: count, deletions: count, total: count }).optional(), files: z.array(file).optional(),
  filesTruncated: z.boolean().optional(), reviewState: z.string().optional(), hasBody: z.boolean().optional(), pullNumber: count.optional(), assigneeGithubIds: z.array(z.string()).optional() }).nullable()

// Validated, repeatable-read adapter for the analytics worker.
@Injectable()
export class AnalyticsInputService {
  constructor(private readonly prisma: PrismaService) {}
  async snapshot(teamId: string, now = new Date()) {
    return this.prisma.$transaction(async tx => {
      const team = await tx.team.findUnique({ where: { id: teamId }, include: { project: { include: { milestones: true } }, repository: true,
        memberships: { where: { role: 'participant' }, include: { user: { select: { id: true, name: true, githubLogin: true, avatarUrl: true } } } } } })
      if (!team) throw new NotFoundException('Team not found')
      const start = team.project.startsOn, end = new Date(team.project.endsOn.getTime() + 86400_000)
      const rows = await tx.event.findMany({ where: { repository: { teamId }, occurredAt: { gte: start, lt: end } },
        include: { author: { select: { userId: true } } }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] })
      const participants = new Set(team.memberships.map(member => member.userId))
      const input: ProjectAnalyticsInput = { teamId, projectId: team.projectId, sourceVersion: team.analyticsVersion, asOf: now.toISOString(),
        settings: { name: team.project.name, startsOn: start.toISOString().slice(0, 10), endsOn: team.project.endsOn.toISOString().slice(0, 10),
          weights: weights.parse(team.project.weights), thresholds: thresholds.parse(team.project.thresholds),
          milestones: team.project.milestones.map(point => ({ id: point.id, title: point.title, date: point.date.toISOString().slice(0, 10) })) },
        members: team.memberships.map(member => member.user),
        memberJoinedOn: Object.fromEntries(team.memberships.map(member => [member.userId, member.joinedAt.toISOString().slice(0, 10)])),
        events: rows.map(event => ({ id: event.id, kind: event.kind, occurredAt: event.occurredAt.toISOString(),
          actorId: event.author?.userId && participants.has(event.author.userId) ? event.author.userId : null,
          payload: payload.parse(event.payload), details: details.parse(event.details) })) }
      const pending = team.repository ? await tx.webhookDelivery.count({ where: { repositoryId: team.repository.id, status: { in: ['pending', 'processing'] } } }) : 0
      return { input, sourceReady: team.repository?.syncStatus === 'complete' && pending === 0, repository: team.repository,
        requests: await tx.recalculationRequest.findMany({ where: { teamId }, select: { id: true, version: true } }) }
    }, { isolationLevel: 'RepeatableRead', timeout: 30000 })
  }
  async week(teamId: string, weekStartsOn: string, sourceVersion: number): Promise<WeeklyAnalyticsInput> {
    const starts = new Date(weekStartsOn + 'T00:00:00.000Z')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartsOn) || !Number.isFinite(starts.getTime())
      || weekStart(starts).toISOString().slice(0, 10) !== weekStartsOn || !Number.isInteger(sourceVersion) || sourceVersion < 1) {
      throw new BadRequestException('Expected a UTC Monday and positive source version')
    }
    const end = new Date(starts.getTime() + 7 * 86400_000)
    return this.prisma.$transaction(async tx => {
      const team = await tx.team.findUnique({ where: { id: teamId }, include: { project: { include: { milestones: true } },
        memberships: { where: { role: 'participant' }, include: { user: true } } } })
      if (!team) throw new NotFoundException('Team not found')
      const projectEnd = new Date(team.project.endsOn.getTime() + 86400_000)
      const events = await tx.event.findMany({ where: { repository: { teamId }, occurredAt: {
        gte: new Date(Math.max(starts.getTime(), team.project.startsOn.getTime())),
        lt: new Date(Math.min(end.getTime(), projectEnd.getTime())),
      } }, include: { author: { select: { userId: true } } }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] })
      const participants = new Set(team.memberships.map(member => member.userId))
      return { teamId, projectId: team.projectId, weekStartsOn, weekEndsBefore: end.toISOString().slice(0, 10), sourceVersion,
        settings: { name: team.project.name, startsOn: team.project.startsOn.toISOString().slice(0, 10), endsOn: team.project.endsOn.toISOString().slice(0, 10),
          weights: weights.parse(team.project.weights), thresholds: thresholds.parse(team.project.thresholds),
          milestones: team.project.milestones.map(point => ({ id: point.id, title: point.title, date: point.date.toISOString().slice(0, 10) })) },
        members: team.memberships.map(({ user }) => ({ id: user.id, name: user.name, githubLogin: user.githubLogin, avatarUrl: user.avatarUrl })),
        events: events.map(event => ({ id: event.id, kind: event.kind, occurredAt: event.occurredAt.toISOString(),
          actorId: event.author?.userId && participants.has(event.author.userId) ? event.author.userId : null, payload: payload.parse(event.payload), details: details.parse(event.details) })),
      }
    }, { isolationLevel: 'RepeatableRead' })
  }
}
