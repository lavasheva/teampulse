import type { ChangeAdjustment } from '@teampulse/shared'
import type { Credit, PeriodEvent } from './events'
import { utcDate } from './period'

type FileReason = Extract<ChangeAdjustment['reason'],
  'lockFile' | 'generated' | 'dependency' | 'buildArtifact' | 'binaryPath' | 'pureRename'>

const fileExplanations: Record<FileReason, string> = {
  lockFile: 'Файл фиксирует версии зависимостей.',
  generated: 'Путь соответствует шаблону сгенерированных файлов.',
  dependency: 'Путь находится в каталоге зависимостей.',
  buildArtifact: 'Путь находится в каталоге сборки.',
  binaryPath: 'Расширение файла характерно для бинарных данных.',
  pureRename: 'Переименование без изменённых строк по статистике GitHub.',
}

const commitLimit = 500
const microLimit = 20
const microWindow = 10 * 60_000
const provisionalUnits = 5

function excludedPath(path: string): FileReason | undefined {
  const parts = path.toLowerCase().split('/')
  const filename = parts.pop() ?? ''
  if (/^(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|cargo\.lock|poetry\.lock|pipfile\.lock|composer\.lock|gemfile\.lock|uv\.lock|go\.sum)$/.test(filename)) return 'lockFile'
  if (parts.some(part => part === 'node_modules' || part === 'vendor' || part === 'bower_components')) return 'dependency'
  if (parts.some(part => part === 'dist' || part === 'build' || part === 'coverage' || part === '.next')) return 'buildArtifact'
  if (parts.includes('__generated__') || /\.(?:generated|gen|min)\.[^.]+$/.test(filename) || /\.pb\.go$/.test(filename)) return 'generated'
  if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|7z|jar|exe|dll|woff2?|ttf|mp[34]|wasm)$/.test(filename)) return 'binaryPath'
}

interface CommitAssessment {
  measured: number
  excluded: number
  units: number
  incomplete: boolean
  provisional: boolean
  adjustments: ChangeAdjustment[]
}
type AssessedCommit = { row: PeriodEvent; assessment: CommitAssessment }

export function assessCommit(row: PeriodEvent): CommitAssessment {
  const { event, userId } = row
  const detail = event.details
  const files = detail?.files ?? []
  const total = detail?.stats?.total
  const listed = files.reduce((sum, file) => sum + file.changes, 0)
  const measured = Math.max(total ?? 0, listed)
  const incomplete = detail?.filesTruncated === true || (total !== undefined ? listed !== total : files.length === 0)
  const adjustments: ChangeAdjustment[] = []
  let excluded = 0
  let eligible = 0
  let provisional = false

  for (const file of files) {
    const pureRename = file.status === 'renamed' && file.changes === 0 && file.additions === 0 && file.deletions === 0
    const reason = pureRename ? 'pureRename' : excludedPath(file.filename)
    if (reason) {
      excluded += file.changes
      adjustments.push({ eventIds: [event.id], userId, reason, path: file.filename,
        lines: file.changes, explanation: fileExplanations[reason] })
    } else {
      eligible += file.changes
    }
  }

  if (!files.length && event.payload.files) {
    const { added, removed, modified } = event.payload.files
    for (const path of [...new Set([...added, ...removed, ...modified])].sort()) {
      const reason = excludedPath(path)
      if (reason) {
        adjustments.push({ eventIds: [event.id], userId, reason, path, lines: null, explanation: fileExplanations[reason] })
      } else if (total !== 0) {
        provisional = true
      }
    }
  }

  if (eligible > commitLimit) {
    const overflow = eligible - commitLimit
    excluded += overflow
    adjustments.push({ eventIds: [event.id], userId, reason: 'largeCommit', lines: overflow,
      explanation: 'Объём допустимых изменений превышает лимит 500 строк на коммит.' })
  }
  return { measured, excluded, incomplete, provisional, adjustments,
    units: provisional ? provisionalUnits : Math.min(eligible, commitLimit) }
}

export function codeCredits(commits: AssessedCommit[]): Credit[] {
  const credits: Credit[] = []
  const groups = new Map<string, AssessedCommit[]>()

  function flushGroup(group: AssessedCommit[], userId: string) {
    const first = group[0]
    const eventIds = group.map(commit => commit.row.event.id)
    const verified = group.reduce((sum, commit) => sum + (commit.assessment.provisional ? 0 : commit.assessment.units), 0)
    const hasProvisional = group.some(commit => commit.assessment.provisional)
    const overflow = Math.max(0, verified - microLimit)
    if (group.length > 1) {
      first.assessment.excluded += overflow
      first.assessment.adjustments.push({ eventIds, userId, reason: 'microCommits',
        lines: hasProvisional && overflow === 0 ? null : overflow,
        explanation: 'Мелкие и предварительно оценённые коммиты за 10 минут учтены как одна серия.' })
    }
    credits.push({ userId, category: 'code', timestamp: first.row.timestamp, eventIds,
      units: verified > 0 ? Math.min(verified, microLimit) : provisionalUnits })
  }

  for (const commit of commits) {
    const { row: { userId, timestamp, event }, assessment } = commit
    if (userId === null || assessment.units === 0) continue
    const small = assessment.provisional || (!assessment.incomplete && assessment.measured <= 5)
    if (!small) {
      credits.push({ userId, timestamp, category: 'code', eventIds: [event.id], units: assessment.units })
      continue
    }
    const group = groups.get(userId)
    if (group && timestamp - group[0].row.timestamp <= microWindow && utcDate(timestamp) === utcDate(group[0].row.timestamp)) {
      group.push(commit)
    } else {
      if (group) flushGroup(group, userId)
      groups.set(userId, [commit])
    }
  }
  for (const [userId, group] of groups) flushGroup(group, userId)
  return credits
}
