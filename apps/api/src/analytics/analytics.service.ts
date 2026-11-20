import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { analyticsEngine, calculateProject, calculateWeek, generateWeeklySummary, createGigaChatProvider, createYandexGptProvider } from '@teampulse/analytics'
import type { AnalyticsResponse, ProjectContributionResult, WeeklyContributionResult, AnalyticsWeeklySummary } from '@teampulse/shared'
import { PrismaService } from '../prisma.service'
import { AnalyticsInputService } from './input.service'
import { weekStart } from '../github/event.store'

const day = 86400_000
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService, private readonly input: AnalyticsInputService) {}

  private provider() {
    const provider = process.env.SUMMARY_PROVIDER ?? 'template'
    if (provider === 'template') return undefined
    if (provider === 'yandexgpt' && process.env.YANDEX_GPT_API_KEY && process.env.YANDEX_GPT_FOLDER_ID) return createYandexGptProvider({ apiKey: process.env.YANDEX_GPT_API_KEY, folderId: process.env.YANDEX_GPT_FOLDER_ID })
    if (provider === 'gigachat' && process.env.GIGACHAT_AUTHORIZATION_KEY) return createGigaChatProvider({ authorizationKey: process.env.GIGACHAT_AUTHORIZATION_KEY })
    return { name: provider, async generate(): Promise<string> { throw new Error('Summary provider configuration incomplete') } }
  }

  async request(teamId: string, now = new Date()) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Team" WHERE id = ${teamId}::uuid FOR UPDATE`
      const repository = await tx.repository.findUnique({ where: { teamId } })
      if (!repository || repository.syncStatus !== 'complete') throw new ConflictException('Сначала дождитесь завершения загрузки истории GitHub.')
      const state = await tx.teamAnalysis.upsert({ where: { teamId }, create: { teamId }, update: {} })
      if (state.manualAt && now.getTime() - state.manualAt.getTime() < 3600000) throw new ConflictException('Обновлять расчёт вручную можно не чаще раза в час.')
      await tx.teamAnalysis.update({ where: { teamId }, data: { manualAt: now, nextAt: now, failures: 0, error: null } })
      return { status: 'pending' as const }
    })
  }

  async run(teamId: string, now = new Date()) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, include: { repository: true } })
    if (!team || team.repository?.syncStatus !== 'complete') return false
    const state = await this.prisma.teamAnalysis.upsert({ where: { teamId }, create: { teamId }, update: {} })
    if (state.requestedVersion === team.analyticsVersion && state.engineVersion === analyticsEngine.version && state.nextAt > now) return false
    const lease = randomUUID()
    const claimed = await this.prisma.teamAnalysis.updateMany({ where: { teamId, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
      data: { leaseToken: lease, leaseUntil: new Date(now.getTime() + 120000), requestedVersion: team.analyticsVersion } })
    if (!claimed.count) return false
    try {
      const snapshot = await this.input.snapshot(teamId, now)
      if (!snapshot.sourceReady) {
        await this.prisma.teamAnalysis.updateMany({ where: { teamId, leaseToken: lease }, data: { leaseToken: null, leaseUntil: null, nextAt: new Date(now.getTime() + 30000) } })
        return false
      }
      const { input } = snapshot
      const projectResult = calculateProject(input)
      const weeks: { starts: Date; result: WeeklyContributionResult; summary: AnalyticsWeeklySummary }[] = []
      const last = Math.min(new Date(input.settings.endsOn).getTime() + day, now.getTime())
      const provider = this.provider()
      const latestEligible = Math.min(weekStart(now).getTime() - 7 * day, weekStart(new Date(last - 1)).getTime())
      for (let at = weekStart(new Date(input.settings.startsOn)).getTime(); at < last; at += 7 * day) {
        if (weeks.length >= 260) throw new Error('Project exceeds supported weekly history')
        const starts = new Date(at)
        const result = calculateWeek({ ...input, weekStartsOn: starts.toISOString().slice(0, 10), weekEndsBefore: new Date(at + 7 * day).toISOString().slice(0, 10), historyStartsOn: input.settings.startsOn })
        // External summary calls only for completed weeks, and only when explicitly configured.
        const summary = await generateWeeklySummary(result, input.members, at === latestEligible ? provider : undefined)
        weeks.push({ starts, result, summary })
      }
      return await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Team" WHERE id = ${teamId}::uuid FOR UPDATE`
        const current = await tx.team.findUniqueOrThrow({ where: { id: teamId }, include: { repository: true } })
        const active = await tx.teamAnalysis.findUniqueOrThrow({ where: { teamId } })
        const pending = current.repository ? await tx.webhookDelivery.count({ where: { repositoryId: current.repository.id, status: { in: ['pending', 'processing'] } } }) : 1
        if (active.leaseToken !== lease) return false
        if (current.analyticsVersion !== input.sourceVersion || current.repository?.syncStatus !== 'complete'
          || current.repository.connectionVersion !== snapshot.repository?.connectionVersion || pending) {
          await tx.teamAnalysis.update({ where: { teamId }, data: { leaseToken: null, leaseUntil: null, nextAt: now } })
          return false
        }
        for (const week of weeks) await tx.weeklySnapshot.upsert({ where: { teamId_weekStartsOn: { teamId, weekStartsOn: week.starts } },
          create: { teamId, weekStartsOn: week.starts, sourceVersion: input.sourceVersion, engineVersion: analyticsEngine.version, result: json(week.result), summary: json(week.summary), computedAt: now },
          update: { sourceVersion: input.sourceVersion, engineVersion: analyticsEngine.version, result: json(week.result), summary: json(week.summary), computedAt: now } })
        await tx.weeklySnapshot.deleteMany({ where: { teamId, weekStartsOn: { notIn: weeks.map(week => week.starts) } } })
        for (const request of snapshot.requests) await tx.recalculationRequest.updateMany({ where: { id: request.id, version: request.version }, data: { processedVersion: request.version } })
        await tx.teamAnalysis.update({ where: { teamId }, data: { sourceVersion: input.sourceVersion, requestedVersion: input.sourceVersion,
          engineVersion: analyticsEngine.version, result: json(projectResult), computedAt: now, nextAt: new Date(Math.floor(now.getTime() / day) * day + day),
          leaseToken: null, leaseUntil: null, failures: 0, error: null } })
        return true
      }, { timeout: 30000 })
    } catch {
      const failures = state.failures + 1
      await this.prisma.teamAnalysis.updateMany({ where: { teamId, leaseToken: lease }, data: { leaseToken: null, leaseUntil: null,
        failures, error: 'ANALYTICS_FAILED', engineVersion: analyticsEngine.version, nextAt: new Date(now.getTime() + Math.min(3600000, 30000 * 2 ** failures)) } }).catch(() => {})
      return false
    }
  }

  async get(teamId: string, now = new Date()): Promise<AnalyticsResponse> {
    return this.prisma.$transaction(async tx => {
      const team = await tx.team.findUnique({ where: { id: teamId }, include: { repository: true, analysis: true,
        snapshots: { orderBy: { weekStartsOn: 'desc' } } } })
      if (!team) throw new NotFoundException('Team not found')
      const source = team.repository?.syncStatus ?? 'not_connected', state = team.analysis
      const pending = team.repository ? await tx.webhookDelivery.count({ where: { repositoryId: team.repository.id, status: { in: ['pending', 'processing'] } } }) : 0
      const stale = !state?.computedAt || state.sourceVersion !== team.analyticsVersion || state.engineVersion !== analyticsEngine.version || state.nextAt <= now || source !== 'complete' || pending > 0
      const status = source === 'not_connected' ? 'not_connected' : source === 'disconnected' ? 'disconnected'
        : source === 'failed' ? 'source_error' : source !== 'complete' || pending ? 'loading'
          : state?.error && state.requestedVersion === team.analyticsVersion ? 'error' : stale ? 'pending' : 'ready'
      return { status, sourceStatus: source, stale, computedAt: state?.computedAt?.toISOString() ?? null, sourceVersion: state?.sourceVersion ?? null,
        engineVersion: state?.engineVersion ?? null, manualAvailableAt: state?.manualAt ? new Date(state.manualAt.getTime() + 3600000).toISOString() : null,
        project: state?.result as unknown as ProjectContributionResult ?? null,
        weeks: team.snapshots.map(snapshot => ({ weekStartsOn: snapshot.weekStartsOn.toISOString().slice(0, 10), result: snapshot.result as unknown as WeeklyContributionResult,
          summary: snapshot.summary as unknown as AnalyticsWeeklySummary })) }
    }, { isolationLevel: 'RepeatableRead' })
  }
}
