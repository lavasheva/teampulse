import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common'
import type { AuthRequest } from '../auth/security'
import { AccessService } from './access.service'
import { ManagerInput, MemberRoleInput } from './dto'

@Controller('projects/:projectId')
export class AccessController {
  constructor(private readonly access: AccessService) {}
  @Get('access')
  list(@Req() req: AuthRequest, @Param('projectId', ParseUUIDPipe) id: string) { return this.access.list(req.user.id, id) }
  @Post('managers')
  add(@Req() req: AuthRequest, @Param('projectId', ParseUUIDPipe) id: string, @Body() input: ManagerInput) {
    return this.access.addManager(req.user.id, id, input.githubLogin)
  }
  @Delete('managers/:userId') @HttpCode(204)
  remove(@Req() req: AuthRequest, @Param('projectId', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.access.removeManager(req.user.id, id, userId)
  }
  @Put('teams/:teamId/members/:userId') @HttpCode(204)
  role(@Req() req: AuthRequest, @Param('projectId', ParseUUIDPipe) id: string, @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('userId', ParseUUIDPipe) userId: string, @Body() input: MemberRoleInput) {
    return this.access.changeMember(req.user.id, id, teamId, userId, input.role)
  }
  @Delete('teams/:teamId/members/:userId') @HttpCode(204)
  member(@Req() req: AuthRequest, @Param('projectId', ParseUUIDPipe) id: string, @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('userId', ParseUUIDPipe) userId: string) { return this.access.changeMember(req.user.id, id, teamId, userId, null) }
}
