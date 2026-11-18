import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { weekStart } from '../github/event.store'

// Internal adapter for the future analytics worker. Never sends data to an external provider.
@Injectable()
export class AnalyticsInputService {
  constructor(private readonly prisma: PrismaService) {}
  async week(teamId: string, weekStartsOn: string, sourceVersion: number) {
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
          weights: team.project.weights, thresholds: team.project.thresholds,
          milestones: team.project.milestones.map(point => ({ id: point.id, title: point.title, date: point.date.toISOString().slice(0, 10) })) },
        members: team.memberships.map(({ user }) => ({ id: user.id, name: user.name, githubLogin: user.githubLogin, avatarUrl: user.avatarUrl })),
        events: events.map(event => ({ id: event.id, kind: event.kind, occurredAt: event.occurredAt.toISOString(),
          actorId: event.author?.userId && participants.has(event.author.userId) ? event.author.userId : null, payload: event.payload, details: event.details })),
      }
    }, { isolationLevel: 'RepeatableRead' })
  }
}
