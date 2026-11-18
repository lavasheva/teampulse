import { BadRequestException, ConflictException, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Req, NotFoundException, Query } from '@nestjs/common'
import { isUUID } from 'class-validator'
import type { AuthRequest } from '../auth/security'
import { PrismaService } from '../prisma.service'
import { WorkspaceService } from '../workspace/workspace.service'
import { HistoryService } from './history.service'
import { invalidateWeeks } from './event.store'

@Controller('teams/:teamId')
export class IdentitiesController {
  constructor(private readonly prisma: PrismaService, private readonly workspace: WorkspaceService,
    private readonly history: HistoryService) {}

  @Get('repository/sync')
  async status(@Req() req: AuthRequest, @Param('teamId', ParseUUIDPipe) teamId: string) {
    await this.workspace.team(req.user.id, teamId)
    const repository = await this.prisma.repository.findUnique({ where: { teamId }, select: {
      syncStatus: true, syncProcessed: true, syncCursor: true, syncRetryAt: true, syncError: true, syncedAt: true,
      nextReconcileAt: true, _count: { select: { events: true } },
    } })
    if (!repository) throw new NotFoundException('Repository not found')
    const { syncCursor, ...publicStatus } = repository
    return { ...publicStatus, stage: syncCursor ? (JSON.parse(syncCursor) as { stage: string }).stage : null }
  }

  @Post('repository/sync')
  async sync(@Req() req: AuthRequest, @Param('teamId', ParseUUIDPipe) teamId: string) {
    const team = await this.workspace.team(req.user.id, teamId)
    if (team.memberships.find(m => m.user.id === req.user.id)?.role === 'observer') {
      try { await this.workspace.requireManager(req.user.id, team.projectId) }
      catch { throw new ForbiddenException('Observers cannot start synchronization') }
    }
    return this.history.request(teamId)
  }

  @Get('identities/unmatched')
  async unmatched(@Req() req: AuthRequest, @Param('teamId', ParseUUIDPipe) teamId: string, @Query('cursor') cursor?: string) {
    const team = await this.workspace.team(req.user.id, teamId)
    if (cursor && (typeof cursor !== 'string' || !isUUID(cursor))) throw new BadRequestException('Invalid cursor')
    const participant = team.memberships.some(member => member.user.id === req.user.id && member.role === 'participant')
    const identities = await this.prisma.gitIdentity.findMany({ where: { repository: { teamId }, userId: null,
      ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, email: true, login: true, githubId: true, _count: { select: { events: true } } },
      orderBy: { id: 'asc' }, take: 101 })
    return { identities: identities.slice(0, 100).map(identity => ({ ...identity,
      canClaim: participant && (!identity.githubId || identity.githubId === req.user.githubId) })),
      nextCursor: identities.length > 100 ? identities[99].id : null }
  }

  @Get('events')
  async events(@Req() req: AuthRequest, @Param('teamId', ParseUUIDPipe) teamId: string, @Query('cursor') cursor?: string) {
    await this.workspace.team(req.user.id, teamId)
    if (cursor && (typeof cursor !== 'string' || !isUUID(cursor))) throw new BadRequestException('Invalid cursor')
    // ID ordering gives stable keyset pagination without exposing another team's event by cursor.
    const events = await this.prisma.event.findMany({ where: { repository: { teamId }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' }, take: 101, select: { id: true, kind: true, occurredAt: true, payload: true, details: true,
        author: { select: { id: true, userId: true, login: true, resolution: true } } } })
    return { events: events.slice(0, 100), nextCursor: events.length > 100 ? events[99].id : null }
  }

  @Post('identities/:identityId/claim')
  async claim(@Req() req: AuthRequest, @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('identityId', ParseUUIDPipe) identityId: string) {
    const membership = await this.prisma.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId: req.user.id } } })
    if (membership?.role !== 'participant') throw new ForbiddenException('Only a team participant may confirm their authorship')
    return this.prisma.$transaction(async tx => {
      const identity = await tx.gitIdentity.findFirst({ where: { id: identityId, repository: { teamId } }, include: { repository: true } })
      if (!identity) throw new NotFoundException('Identity not found')
      await tx.$queryRaw`SELECT id FROM "GitIdentity" WHERE id = ${identityId}::uuid FOR UPDATE`
      const current = await tx.gitIdentity.findUniqueOrThrow({ where: { id: identityId } })
      if (current.githubId && current.githubId !== req.user.githubId) throw new ConflictException('GitHub identifies a different author')
      if (current.userId && current.userId !== req.user.id) throw new ConflictException('Identity is already assigned')
      if (current.userId === req.user.id) return { id: identityId, userId: req.user.id }
      await tx.gitIdentity.update({ where: { id: identityId }, data: { userId: req.user.id, resolution: 'claimed' } })
      await tx.identityResolution.create({ data: { identityId, actorId: req.user.id, toUserId: req.user.id, reason: 'claimed' } })
      const events = await tx.event.findMany({ where: { authorId: identityId }, select: { occurredAt: true } })
      await invalidateWeeks(tx, identity.repository.teamId, events.map(event => event.occurredAt))
      return { id: identityId, userId: req.user.id }
    })
  }
}
