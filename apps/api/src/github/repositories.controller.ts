import { Body, ConflictException, Controller, Get, Param, ParseUUIDPipe, Post, Req, ForbiddenException } from '@nestjs/common'
import { IsOptional, IsString, Matches } from 'class-validator'
import { Prisma } from '@prisma/client'
import type { AuthRequest } from '../auth/security'
import { WorkspaceService } from '../workspace/workspace.service'
import { PrismaService } from '../prisma.service'
import { GitHubAppClient } from './app.client'

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
        const previous = await tx.repository.findUnique({ where: { teamId } })
        if (previous && previous.externalId !== verified.externalId) throw new ConflictException('Team already has a different repository')
        return tx.repository.upsert({ where: { teamId },
          create: { teamId, ...verified, installationId },
          update: { fullName: verified.fullName, installationId, syncStatus: 'pending',
            syncCursor: null, syncProcessed: 0, syncFailures: 0, syncError: null, syncRetryAt: null,
            syncLeaseToken: null, syncLeaseUntil: null },
          select: { id: true, fullName: true, syncStatus: true } })
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Repository is already connected to a team')
      }
      throw error
    }
  }
}
