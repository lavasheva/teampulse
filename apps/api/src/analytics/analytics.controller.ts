import { Controller, Get, Param, ParseUUIDPipe, Post, Req, ForbiddenException } from '@nestjs/common'
import type { AuthRequest } from '../auth/security'
import { WorkspaceService } from '../workspace/workspace.service'
import { AnalyticsService } from './analytics.service'

@Controller('teams/:teamId/analytics')
export class AnalyticsController {
  constructor(private readonly workspace: WorkspaceService, private readonly analytics: AnalyticsService) {}
  @Get()
  async get(@Req() req: AuthRequest, @Param('teamId', ParseUUIDPipe) id: string) {
    await this.workspace.team(req.user.id, id)
    return this.analytics.get(id)
  }
  @Post('refresh')
  async refresh(@Req() req: AuthRequest, @Param('teamId', ParseUUIDPipe) id: string) {
    const team = await this.workspace.team(req.user.id, id)
    if (team.memberships.find(member => member.user.id === req.user.id)?.role === 'observer') {
      try { await this.workspace.requireManager(req.user.id, team.projectId) }
      catch { throw new ForbiddenException('Наблюдатель не может запускать расчёт.') }
    }
    return this.analytics.request(id)
  }
}
