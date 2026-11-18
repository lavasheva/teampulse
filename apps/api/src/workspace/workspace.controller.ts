import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common'
import type { AuthRequest } from '../auth/security'
import { InvitationInput, JoinInput, OrganizationInput, ProjectInput, TeamInput } from './dto'
import { WorkspaceService } from './workspace.service'

@Controller()
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  @Get('organizations')
  organizations(@Req() req: AuthRequest) { return this.workspace.organizations(req.user.id) }

  @Post('organizations')
  createOrganization(@Req() req: AuthRequest, @Body() input: OrganizationInput) {
    return this.workspace.createOrganization(req.user.id, input)
  }

  @Post('organizations/:organizationId/projects')
  createProject(@Req() req: AuthRequest, @Param('organizationId', ParseUUIDPipe) id: string,
    @Body() input: ProjectInput) { return this.workspace.createProject(req.user.id, id, input) }

  @Get('projects')
  projects(@Req() req: AuthRequest) { return this.workspace.projects(req.user.id) }

  @Get('teams/:teamId')
  team(@Req() req: AuthRequest, @Param('teamId', ParseUUIDPipe) id: string) {
    return this.workspace.team(req.user.id, id)
  }

  @Post('projects/:projectId/teams')
  createTeam(@Req() req: AuthRequest, @Param('projectId', ParseUUIDPipe) id: string, @Body() input: TeamInput) {
    return this.workspace.createTeam(req.user.id, id, input.name)
  }

  @Post('projects/:projectId/invitations')
  invite(@Req() req: AuthRequest, @Param('projectId', ParseUUIDPipe) id: string, @Body() input: InvitationInput) {
    return this.workspace.createInvitation(req.user.id, id, input?.role ?? 'participant')
  }

  @Delete('projects/:projectId/invitations/:invitationId')
  @HttpCode(204)
  revoke(@Req() req: AuthRequest, @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string) {
    return this.workspace.revokeInvitation(req.user.id, projectId, invitationId)
  }

  @Get('invitations/:token')
  invitation(@Param('token') value: string) { return this.workspace.invitation(value) }

  @Post('invitations/:token/accept')
  join(@Req() req: AuthRequest, @Param('token') value: string, @Body() input: JoinInput) {
    return this.workspace.join(req.user.id, value, input.teamId)
  }
}
