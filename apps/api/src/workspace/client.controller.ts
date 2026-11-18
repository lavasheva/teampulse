import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common'
import type { AuthRequest } from '../auth/security'
import { ClientService } from './client.service'

@Controller()
export class ClientController {
  constructor(private readonly client: ClientService) {}
  @Get('workspace')
  workspace(@Req() req: AuthRequest) { return this.client.load(req.user.id) }

  @Put('projects/:projectId/settings')
  settings(@Req() req: AuthRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() input: unknown) {
    return this.client.settings(req.user.id, projectId, input)
  }

  @Get('teams/:teamId/members/:memberId')
  member(@Req() req: AuthRequest, @Param('teamId', ParseUUIDPipe) teamId: string, @Param('memberId', ParseUUIDPipe) memberId: string) {
    return this.client.member(req.user.id, teamId, memberId)
  }
}
