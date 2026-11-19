import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common'
import { EventKind, type Prisma } from '@prisma/client'
import { z } from 'zod'
import type { AuthRequest } from '../auth/security'
import { PrismaService } from '../prisma.service'
import { WorkspaceService } from './workspace.service'
import { pageScope, readCursor, writeCursor } from './pagination'

const feedSchema = z.object({ kind: z.enum(EventKind).optional(), author: z.union([z.uuid(), z.literal('unmatched')]).optional(),
  from: z.iso.date().optional(), to: z.iso.date().optional(), cursor: z.string().max(1000).optional() }).strict()
  .refine(value => !value.from || !value.to || value.from <= value.to, 'Начало периода должно быть не позже конца.')
const auditSchema = z.object({ cursor: z.string().max(1000).optional() }).strict()
const size = 50

@Controller()
export class ActivityController {
  constructor(private readonly prisma: PrismaService, private readonly workspace: WorkspaceService) {}

  @Get('teams/:teamId/activity')
  async feed(@Req() req: AuthRequest, @Param('teamId', ParseUUIDPipe) teamId: string, @Query() query: unknown) {
    await this.workspace.team(req.user.id, teamId)
    const parsed = feedSchema.safeParse(query)
    if (!parsed.success) throw new BadRequestException('Проверьте тип события, автора и даты периода.')
    const { cursor: value, ...filters } = parsed.data
    const scope = pageScope({ teamId, ...filters }), cursor = readCursor(value, scope)
    const where: Prisma.EventWhereInput = { repository: { teamId },
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.author === 'unmatched' ? { OR: [{ authorId: null }, { author: { userId: null } }] }
        : filters.author ? { author: { userId: filters.author } } : {}),
      occurredAt: { ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lt: new Date(new Date(filters.to).getTime() + 86400_000) } : {}) },
      ...(cursor ? { AND: [{ OR: [{ occurredAt: { lt: cursor.at } }, { occurredAt: cursor.at, id: { lt: cursor.id } }] }] } : {}),
    }
    const rows = await this.prisma.event.findMany({ where, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: size + 1,
      select: { id: true, kind: true, occurredAt: true, payload: true, details: true,
        author: { select: { id: true, userId: true, login: true, resolution: true } } } })
    const last = rows[size - 1]
    return { events: rows.slice(0, size), nextCursor: rows.length > size ? writeCursor(last.id, last.occurredAt, scope) : null }
  }

  @Get('projects/:projectId/audit')
  async audit(@Req() req: AuthRequest, @Param('projectId', ParseUUIDPipe) projectId: string, @Query() query: unknown) {
    await this.workspace.requireManager(req.user.id, projectId)
    const parsed = auditSchema.safeParse(query)
    if (!parsed.success) throw new BadRequestException('Некорректная страница журнала.')
    const scope = pageScope({ projectId }), cursor = readCursor(parsed.data.cursor, scope)
    const rows = await this.prisma.projectAudit.findMany({ where: { projectId,
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: size + 1,
      select: { id: true, createdAt: true, actorLogin: true, action: true, teamId: true, targetId: true, subject: true, beforeRole: true, afterRole: true } })
    const last = rows[size - 1]
    return { entries: rows.slice(0, size), nextCursor: rows.length > size ? writeCursor(last.id, last.createdAt, scope) : null }
  }
}
