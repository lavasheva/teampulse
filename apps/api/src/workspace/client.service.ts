import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { z } from 'zod'
import { PrismaService } from '../prisma.service'
import { WorkspaceService } from './workspace.service'
import { invalidateWeeks } from '../github/event.store'
import { recordAudit } from './audit'

const day = z.iso.date()
const settingsSchema = z.object({
  name: z.string().trim().min(1).max(120), startsOn: day, endsOn: day,
  weights: z.object({ code: z.number().int().min(0).max(100), pullRequests: z.number().int().min(0).max(100),
    reviews: z.number().int().min(0).max(100), issues: z.number().int().min(0).max(100) }).strict()
    .refine(values => Object.values(values).reduce((a, b) => a + b, 0) === 100, 'Weights must sum to 100'),
  thresholds: z.object({ inactivity: z.number().int().min(1).max(365), imbalance: z.number().int().min(1).max(100),
    lateBurst: z.number().int().min(1).max(100), excluded: z.number().int().min(1).max(100) }).strict(),
  milestones: z.array(z.object({ id: z.uuid(), title: z.string().trim().min(1).max(120), date: day }).strict()).max(50),
}).strict().superRefine((value, context) => {
  if (value.startsOn > value.endsOn) context.addIssue({ code: 'custom', message: 'End must not precede start' })
  if (value.milestones.some(point => point.date < value.startsOn || point.date > value.endsOn)) {
    context.addIssue({ code: 'custom', message: 'Milestones must fall within project dates' })
  }
  if (new Set(value.milestones.map(point => point.id)).size !== value.milestones.length) {
    context.addIssue({ code: 'custom', message: 'Milestone IDs must be unique' })
  }
})

@Injectable()
export class ClientService {
  constructor(private readonly prisma: PrismaService, private readonly workspace: WorkspaceService) {}

  async load(userId: string) {
    const manager = { OR: [{ managers: { some: { userId } } },
      { organization: { memberships: { some: { userId, role: 'owner' as const } } } }] }
    const projects = await this.prisma.project.findMany({ where: { OR: [manager,
      { teams: { some: { memberships: { some: { userId } } } } }] },
      select: { id: true, name: true, startsOn: true, endsOn: true, weights: true, thresholds: true,
        milestones: { select: { id: true, title: true, date: true }, orderBy: { date: 'asc' } },
        managers: { where: { userId }, select: { userId: true } },
        organization: { select: { id: true, name: true, kind: true,
          memberships: { where: { userId, role: 'owner' }, select: { userId: true } } } },
        teams: { where: { OR: [{ project: manager }, { memberships: { some: { userId } } }] },
          select: { id: true, name: true, memberships: { select: { role: true,
            user: { select: { id: true, githubLogin: true, name: true, avatarUrl: true } } } },
            repository: { select: { fullName: true, syncStatus: true, _count: { select: { events: true } } } } },
          orderBy: { createdAt: 'asc' } },
      }, orderBy: { createdAt: 'desc' }, take: 100 })
    return { organizations: await this.workspace.organizations(userId), projects: projects.map(project => {
      const canManage = Boolean(project.managers.length || project.organization.memberships.length)
      return { id: project.id, organization: { id: project.organization.id, name: project.organization.name, kind: project.organization.kind },
        canManage, settings: { name: project.name, startsOn: project.startsOn.toISOString().slice(0, 10),
          endsOn: project.endsOn.toISOString().slice(0, 10), weights: project.weights, thresholds: project.thresholds,
          milestones: project.milestones.map(point => ({ ...point, date: point.date.toISOString().slice(0, 10) })) },
        teams: project.teams.map(team => ({ ...team, canConnect: canManage || team.memberships.some(member => member.user.id === userId && member.role === 'participant') })),
        analytics: { status: 'not_configured' as const },
      }
    }) }
  }

  async settings(userId: string, projectId: string, input: unknown) {
    await this.workspace.requireManager(userId, projectId)
    const validated = settingsSchema.safeParse(input)
    if (!validated.success) throw new BadRequestException(validated.error.issues.map(issue => issue.message))
    const value = validated.data
    return this.prisma.$transaction(async tx => {
      await tx.project.update({ where: { id: projectId }, data: { name: value.name,
        startsOn: new Date(value.startsOn), endsOn: new Date(value.endsOn), weights: value.weights, thresholds: value.thresholds } })
      // Reuse only this project's milestone IDs. An ID from a different project is rejected.
      const foreign = await tx.milestone.count({ where: { id: { in: value.milestones.map(point => point.id) }, projectId: { not: projectId } } })
      if (foreign) throw new BadRequestException('Milestone belongs to another project')
      await tx.milestone.deleteMany({ where: { projectId } })
      if (value.milestones.length) await tx.milestone.createMany({ data: value.milestones.map(point => ({ ...point, projectId, date: new Date(point.date) })) })
      const events = await tx.event.findMany({ where: { repository: { team: { projectId } } },
        select: { occurredAt: true, repository: { select: { teamId: true } } } })
      const dates = new Map<string, Date[]>()
      for (const event of events) dates.set(event.repository.teamId, [...(dates.get(event.repository.teamId) ?? []), event.occurredAt])
      for (const [teamId, weeks] of dates) await invalidateWeeks(tx, teamId, weeks)
      await recordAudit(tx, { projectId, actorId: userId, action: 'settings_updated' })
      return { ...value }
    }, { timeout: 30000 })
  }

  async member(userId: string, teamId: string, memberId: string) {
    const team = await this.workspace.team(userId, teamId)
    const member = team.memberships.find(item => item.user.id === memberId)
    if (!member) throw new NotFoundException('Member not found')
    const activity = await this.prisma.event.groupBy({ by: ['kind'], where: { repository: { teamId }, author: { userId: memberId } }, _count: true })
    return { ...member, rawActivity: activity.map(item => ({ kind: item.kind, count: item._count })), analytics: { status: 'not_configured' as const } }
  }
}
