import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, TeamRole } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { WorkspaceService } from './workspace.service'
import { invalidateWeeks } from '../github/event.store'
import { recordAudit } from './audit'

const publicUser = { id: true, githubLogin: true, name: true, avatarUrl: true } as const
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService, private readonly workspace: WorkspaceService) {}

  private async authorize(tx: Prisma.TransactionClient, userId: string, projectId: string, ownerOnly = false) {
    // Serialize access changes for this project, including manager revocation.
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`
    const project = await tx.project.findFirst({ where: { id: projectId, OR: [
      { organization: { memberships: { some: { userId, role: 'owner' } } } },
      ...(ownerOnly ? [] : [{ managers: { some: { userId } } }]),
    ] } })
    if (!project) throw new NotFoundException('Project not found')
    return project
  }

  async list(userId: string, projectId: string) {
    const project = await this.workspace.requireManager(userId, projectId)
    const [owners, managers, invitations] = await Promise.all([
      this.prisma.orgMembership.findMany({ where: { organizationId: project.organizationId, role: 'owner' }, select: { user: { select: publicUser } } }),
      this.prisma.projectManager.findMany({ where: { projectId }, select: { user: { select: publicUser } }, orderBy: { userId: 'asc' } }),
      this.prisma.invitation.findMany({ where: { projectId, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, role: true, createdAt: true, expiresAt: true }, orderBy: { createdAt: 'desc' } }),
    ])
    return { canManageManagers: owners.some(owner => owner.user.id === userId), owners: owners.map(row => row.user),
      managers: managers.map(row => row.user), invitations }
  }

  addManager(userId: string, projectId: string, githubLogin: string) {
    return this.prisma.$transaction(async tx => {
      await this.authorize(tx, userId, projectId, true)
      const users = await tx.user.findMany({ where: { githubLogin: { equals: githubLogin, mode: 'insensitive' } }, take: 2, select: publicUser })
      if (users.length !== 1) throw new BadRequestException('Пользователь должен сначала войти в TeamPulse через GitHub. Проверьте логин.')
      const user = users[0]
      const existing = await tx.projectManager.findUnique({ where: { projectId_userId: { projectId, userId: user.id } } })
      await tx.projectManager.upsert({ where: { projectId_userId: { projectId, userId: user.id } },
        create: { projectId, userId: user.id }, update: {} })
      if (!existing) await recordAudit(tx, { projectId, actorId: userId, action: 'manager_added', targetId: user.id, subject: user.githubLogin })
      return user
    })
  }

  removeManager(userId: string, projectId: string, targetId: string) {
    return this.prisma.$transaction(async tx => {
      const project = await this.authorize(tx, userId, projectId, true)
      const owner = await tx.orgMembership.findFirst({ where: { organizationId: project.organizationId, userId: targetId, role: 'owner' } })
      if (owner) throw new BadRequestException('Владелец организации сохраняет доступ к проекту.')
      const result = await tx.projectManager.deleteMany({ where: { projectId, userId: targetId } })
      if (!result.count) throw new NotFoundException('Manager not found')
      const target = await tx.user.findUnique({ where: { id: targetId }, select: { githubLogin: true } })
      await recordAudit(tx, { projectId, actorId: userId, action: 'manager_removed', targetId, subject: target?.githubLogin })
    })
  }

  changeMember(userId: string, projectId: string, teamId: string, targetId: string, role: TeamRole | null) {
    return this.prisma.$transaction(async tx => {
      await this.authorize(tx, userId, projectId)
      const member = await tx.teamMembership.findFirst({ where: { projectId, teamId, userId: targetId } })
      if (!member) throw new NotFoundException('Member not found')
      if (role === member.role) return
      if (role) await tx.teamMembership.update({ where: { teamId_userId: { teamId, userId: targetId } }, data: { role } })
      else await tx.teamMembership.delete({ where: { teamId_userId: { teamId, userId: targetId } } })
      const target = await tx.user.findUnique({ where: { id: targetId }, select: { githubLogin: true } })
      await recordAudit(tx, { projectId, actorId: userId, action: role ? 'member_role_changed' : 'member_removed', teamId, targetId,
        subject: target?.githubLogin, beforeRole: member.role, ...(role ? { afterRole: role } : {}) })
      const events = await tx.event.findMany({ where: { repository: { teamId } }, select: { occurredAt: true } })
      await invalidateWeeks(tx, teamId, events.map(event => event.occurredAt), true)
      // Keep immutable history and attribution; analytics considers only current participants.
      if (role === 'participant') await tx.repository.updateMany({ where: { teamId, syncStatus: 'complete' },
        data: { syncStatus: 'pending', syncCursor: null, syncProcessed: 0, syncRetryAt: null, syncError: null } })
    }, { timeout: 30000 })
  }
}
