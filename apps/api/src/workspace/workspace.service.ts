import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, TeamRole } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { hash, token } from '../auth/security'
import { OrganizationInput, ProjectInput } from './dto'
import { invalidateWeeks } from '../github/event.store'

const userSelect = { id: true, name: true, githubLogin: true, avatarUrl: true } as const

@Injectable()
export class WorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  private manages(userId: string): Prisma.ProjectWhereInput {
    return { OR: [{ managers: { some: { userId } } },
      { organization: { memberships: { some: { userId, role: 'owner' } } } }] }
  }

  async requireManager(userId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...this.manages(userId) } })
    if (!project) throw new NotFoundException('Project not found')
    return project
  }

  organizations(userId: string) {
    return this.prisma.organization.findMany({ where: { memberships: { some: { userId } } },
      select: { id: true, name: true, kind: true, memberships: { where: { userId }, select: { role: true } } },
      orderBy: { createdAt: 'desc' }, take: 100 })
  }

  createOrganization(userId: string, input: OrganizationInput) {
    return this.prisma.organization.create({ data: { ...input, memberships: { create: { userId, role: 'owner' } } },
      select: { id: true, name: true, kind: true } })
  }

  async createProject(userId: string, organizationId: string, input: ProjectInput) {
    if (input.endsOn < input.startsOn) throw new BadRequestException('Project end must not precede start')
    const membership = await this.prisma.orgMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    })
    if (!membership) throw new NotFoundException('Organization not found')
    return this.prisma.project.create({ data: { organizationId, name: input.name,
      startsOn: new Date(input.startsOn), endsOn: new Date(input.endsOn),
      weights: { code: 25, pullRequests: 25, reviews: 25, issues: 25 },
      thresholds: { inactivity: 7, imbalance: 60, lateBurst: 50, excluded: 50 },
      managers: { create: { userId } }, teams: { create: { name: input.teamName } } },
      select: { id: true, name: true, startsOn: true, endsOn: true, teams: { select: { id: true, name: true } } } })
  }

  async projects(userId: string) {
    return this.prisma.project.findMany({ where: { OR: [this.manages(userId),
      { teams: { some: { memberships: { some: { userId } } } } }] },
      select: { id: true, name: true, startsOn: true, endsOn: true, organizationId: true,
        teams: { where: { OR: [{ project: this.manages(userId) }, { memberships: { some: { userId } } }] },
          select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 })
  }

  async team(userId: string, id: string) {
    const team = await this.prisma.team.findFirst({ where: { id, OR: [
      { project: this.manages(userId) }, { memberships: { some: { userId } } } ] },
      select: { id: true, name: true, projectId: true,
        memberships: { select: { role: true, user: { select: userSelect } } },
        repository: { select: { fullName: true, syncStatus: true } } } })
    if (!team) throw new NotFoundException('Team not found')
    return team
  }

  async createTeam(userId: string, projectId: string, name: string) {
    await this.requireManager(userId, projectId)
    return this.prisma.team.create({ data: { projectId, name }, select: { id: true, name: true, projectId: true } })
  }

  async createInvitation(userId: string, projectId: string, role: TeamRole = 'participant') {
    await this.requireManager(userId, projectId)
    const value = token()
    const expiresAt = new Date(Date.now() + 7 * 86400_000)
    const invitation = await this.prisma.invitation.create({ data: { projectId, tokenHash: hash(value), expiresAt, role },
      select: { id: true, expiresAt: true } })
    return { ...invitation, token: value }
  }

  async revokeInvitation(userId: string, projectId: string, id: string) {
    await this.requireManager(userId, projectId)
    const result = await this.prisma.invitation.updateMany({ where: { id, projectId, revokedAt: null },
      data: { revokedAt: new Date() } })
    if (!result.count) throw new NotFoundException('Invitation not found')
  }

  async invitation(value: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new NotFoundException('Invitation not found')
    const invitation = await this.prisma.invitation.findFirst({ where: { tokenHash: hash(value), revokedAt: null,
      expiresAt: { gt: new Date() } }, select: { expiresAt: true, role: true,
      project: { select: { id: true, name: true, organization: { select: { name: true } },
        teams: { select: { id: true, name: true, _count: { select: { memberships: true } } } } } } } })
    if (!invitation) throw new NotFoundException('Invitation not found')
    return invitation
  }

  async join(userId: string, value: string, teamId: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new NotFoundException('Invitation not found')
    try {
      return await this.prisma.$transaction(async tx => {
        // Revoke waits for this shared lock. A join cannot succeed after a committed revocation.
        const rows = await tx.$queryRaw<{ projectId: string; role: TeamRole }[]>`
          SELECT "projectId", "role" FROM "Invitation" WHERE "tokenHash" = ${hash(value)}
          AND "revokedAt" IS NULL AND "expiresAt" > NOW() FOR SHARE`
        const invitation = rows[0]
        if (!invitation) throw new NotFoundException('Invitation not found')
        const team = await tx.team.findFirst({ where: { id: teamId, projectId: invitation.projectId } })
        if (!team) throw new NotFoundException('Team not found')
        const existing = await tx.teamMembership.findUnique({
          where: { projectId_userId: { projectId: invitation.projectId, userId } },
        })
        if (existing && existing.teamId !== teamId) throw new ConflictException('Already a member of another team in this project')
        if (!existing) await tx.teamMembership.create({ data: { teamId, userId, projectId: invitation.projectId, role: invitation.role } })
        if (!existing) {
          const events = await tx.event.findMany({ where: { repository: { teamId } }, select: { occurredAt: true } })
          await invalidateWeeks(tx, teamId, events.map(event => event.occurredAt))
        }
        // Resolve old authors asynchronously on the next scan, without slowing down joining a large team.
        if (!existing) await tx.repository.updateMany({ where: { teamId, syncStatus: 'complete' },
          data: { syncStatus: 'pending', syncCursor: null, syncProcessed: 0, syncRetryAt: null, syncError: null } })
        return { projectId: invitation.projectId, teamId }
      }, { timeout: 30000 })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
        throw new ConflictException('Membership changed concurrently; reload and try again')
      }
      throw error
    }
  }
}
