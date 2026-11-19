import { Body, ConflictException, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, ForbiddenException, NotFoundException } from '@nestjs/common'
import { IsOptional, IsString, Matches } from 'class-validator'
import { Prisma } from '@prisma/client'
import type { AuthRequest } from '../auth/security'
import { WorkspaceService } from '../workspace/workspace.service'
import { PrismaService } from '../prisma.service'
import { GitHubAppClient } from './app.client'
import { recordAudit } from '../workspace/audit'

class RepositoryInput {
  @IsOptional() @IsString() @Matches(/^[1-9][0-9]{0,14}$/) installationId?: string
  @IsString() @Matches(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/) fullName!: string
}

@Controller()
export class RepositoriesController {
  constructor(private readonly workspace: WorkspaceService, private readonly prisma: PrismaService,
    private readonly github: GitHubAppClient) {}

  @Get('github/app')
  info() {
    const slug = process.env.GITHUB_APP_SLUG
    return { installationUrl: slug && /^[a-z0-9-]+$/.test(slug)
      ? `https://github.com/apps/${slug}/installations/new` : null }
  }

  @Delete('teams/:teamId/repository') @HttpCode(204)
  async disconnect(@Req() req: AuthRequest, @Param('teamId', ParseUUIDPipe) teamId: string) {
    const team = await this.workspace.team(req.user.id, teamId)
    await this.workspace.requireManager(req.user.id, team.projectId)
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Repository" WHERE "teamId" = ${teamId}::uuid FOR UPDATE`
      const repository = await tx.repository.findUnique({ where: { teamId } })
      if (!repository) throw new NotFoundException('Repository not found')
      if (repository.syncStatus === 'disconnected') return
      await tx.repository.update({ where: { teamId }, data: { syncStatus: 'disconnected',
        connectionVersion: { increment: 1 }, syncError: 'USER_DISCONNECTED', syncRetryAt: null,
        syncLeaseToken: null, syncLeaseUntil: null, nextReconcileAt: null } })
      await recordAudit(tx, { projectId: team.projectId, actorId: req.user.id, action: 'repository_disconnected', teamId, targetId: repository.id, subject: repository.fullName })
    })
  }

  @Post('teams/:teamId/repository')
  async connect(@Req() req: AuthRequest, @Param('teamId', ParseUUIDPipe) teamId: string, @Body() input: RepositoryInput) {
    const team = await this.workspace.team(req.user.id, teamId)
    const membership = team.memberships.find(m => m.user.id === req.user.id)
    if (membership?.role === 'observer') {
      // An observer who also manages the project retains their manager permission.
      try { await this.workspace.requireManager(req.user.id, team.projectId) }
      catch { throw new ForbiddenException('Observers cannot connect repositories') }
    }
    const installationId = input.installationId ?? await this.github.findInstallation(input.fullName)
    const verified = await this.github.verifyRepository(installationId, input.fullName, req.user.githubId)
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Repository" WHERE "teamId" = ${teamId}::uuid FOR UPDATE`
        const previous = await tx.repository.findUnique({ where: { teamId } })
        if (previous && previous.externalId !== verified.externalId) throw new ConflictException('Team already has a different repository')
        const repository = await tx.repository.upsert({ where: { teamId },
          create: { teamId, ...verified, installationId },
          update: { fullName: verified.fullName, installationId, syncStatus: 'pending', connectionVersion: { increment: 1 },
            syncCursor: null, syncProcessed: 0, syncFailures: 0, syncError: null, syncRetryAt: null,
            syncLeaseToken: null, syncLeaseUntil: null, nextReconcileAt: null },
          select: { id: true, fullName: true, syncStatus: true } })
        await recordAudit(tx, { projectId: team.projectId, actorId: req.user.id, action: previous ? 'repository_reconnected' : 'repository_connected', teamId, targetId: repository.id, subject: repository.fullName })
        return repository
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Repository is already connected to a team')
      }
      throw error
    }
  }
}
