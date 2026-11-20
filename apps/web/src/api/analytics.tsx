import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import type { AnalyticsResponse, ContributionMetrics, LiveProject, ProjectContributionResult } from '@teampulse/shared'
import { Badge, Button, Panel } from '../components/ui'
import { ActivityChart } from '../components/activity-chart'
import { api } from './client'
import { useApiMutation } from './hooks'

type LiveTeam = LiveProject['teams'][number]
const number = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
const date = (value: string) => new Date(value).toLocaleDateString('ru-RU', { timeZone: 'UTC' })
const statuses: Record<AnalyticsResponse['status'], string> = {
  not_connected: 'Подключите репозиторий, чтобы рассчитать вклад.', disconnected: 'Сбор событий остановлен. Сохранённый расчёт может быть устаревшим.',
  source_error: 'Не удалось загрузить историю GitHub. Восстановите подключение на странице команды.',
  loading: 'История GitHub загружается. Расчёт начнётся после обработки событий.', pending: 'Расчёт ожидается. Результат обновится автоматически.',
  error: 'Не удалось обновить расчёт. Сервис повторит попытку автоматически.', ready: 'Расчёт готов',
}
const palette = ['#5750b9', '#378796', '#c58435', '#b1537a', '#6d8c43', '#6384bd']

function useAnalytics(teamId: string) {
  return useQuery({ queryKey: ['api', 'analytics', teamId], queryFn: () => api.analytics(teamId), refetchInterval: 5000 })
}
function ErrorMessage({ error }: { error: unknown }) {
  return error ? <p role="alert" className="my-2 text-sm">{error instanceof Error ? error.message : 'Не удалось загрузить аналитические данные.'}</p> : null
}
function EvidenceEvent({ teamId, eventId }: { teamId: string; eventId: string }) {
  const event = useQuery({ queryKey: ['api', 'event', teamId, eventId], queryFn: () => api.event(teamId, eventId) })
  return <li className="my-1 break-words">{event.data ? <a href={event.data.payload.url} target="_blank" rel="noreferrer">{event.data.payload.title} · {date(event.data.occurredAt)}</a>
    : event.isError ? 'Событие недоступно' : 'Загружаем событие…'}</li>
}
function Evidence({ teamId, ids }: { teamId: string; ids: string[] }) {
  const [open, setOpen] = useState(false), [limit, setLimit] = useState(10)
  if (!ids.length) return null
  return <details className="mt-2 text-xs" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer">События-основания ({ids.length})</summary>
    {open && <><ul>{ids.slice(0, limit).map(id => <EvidenceEvent key={id} teamId={teamId} eventId={id} />)}</ul>
      {limit < ids.length && <Button variant="outline" onClick={() => setLimit(value => value + 10)}>Ещё основания</Button>}</>}
  </details>
}
function Metrics({ value }: { value: ContributionMetrics }) {
  return <span>{number(value.totalPoints)} балла · {number(value.sharePercent)}% · активных дней: {value.activeDays} ({number(value.activeDaysPercent)}%)
    <br /><span className="muted">Средний промежуток между активными днями: {value.averageGapDays === null ? 'недостаточно данных' : `${number(value.averageGapDays)} дн.`}; последняя активность: {value.lastActiveOn ? date(value.lastActiveOn) : 'нет'}</span></span>
}
function Result({ project, team, result, memberId }: { project: LiveProject; team: LiveTeam; result: ProjectContributionResult; memberId?: string }) {
  const name = (id: string) => { const member = team.memberships.find(item => item.user.id === id)?.user; return member?.name ?? member?.githubLogin ?? 'Участник' }
  const members = result.members.filter(member => !memberId || member.userId === memberId)
  const flags = result.flags.filter(flag => !memberId || flag.userId === memberId || !flag.userId)
  const adjustments = result.adjustments.filter(item => !memberId || item.userId === memberId)
  return <>
    <Panel title={memberId ? 'Личный вклад' : 'Вклад за выбранный период'}>
      <p className="mb-3 text-xs muted">{result.period ? `Период: ${date(result.period.startsAt)} — ${date(new Date(Date.parse(result.period.endsBefore) - 1).toISOString())} (UTC)` : 'Наблюдаемый период ещё не начался.'}</p>
      {!memberId && <p className="mb-4">Всего баллов: <strong>{number(result.totalPoints)}</strong> · Джини: <strong>{number(result.gini)}</strong> <span className="text-xs muted">(0 — равномерно, 1 — сосредоточено у одного участника)</span></p>}
      {!result.totalPoints && <p className="mb-3 text-sm">Измеренного вклада нет. Нулевой Джини в этом случае не означает равную активность.</p>}
      {members.length ? <div className="table-scroll"><table className="w-full min-w-[640px]">
        <thead><tr><th>Участник</th><th>Взвешенный вклад и регулярность</th><th>Код</th><th>PR</th><th>Ревью</th><th>Задачи</th></tr></thead>
        <tbody>{[...members].sort((a, b) => b.sharePercent - a.sharePercent).map(member => <tr key={member.userId}>
          <td><Link to={`/projects/${project.id}/teams/${team.id}/members/${member.userId}`}>{name(member.userId)}</Link></td>
          <td><Metrics value={member} /></td><td>{number(member.work.code)}</td><td>{number(member.work.pullRequests)}</td><td>{number(member.work.reviews)}</td><td>{number(member.work.issues)}</td>
        </tr>)}</tbody></table></div> : <p>Участник не входит в текущий состав расчёта. Наблюдатели в расчёте не участвуют.</p>}
      <p className="mt-3 text-xs muted">Категории показаны в единицах работы; баллы учитывают веса проекта. Результат относится к текущему составу команды.</p>
      {!!result.unknownAuthors.count && <p className="mt-3 text-sm">Событий без сопоставленного участника: {result.unknownAuthors.count}. Они не увеличивают личный вклад.</p>}
      {!!result.commitsWithIncompleteStats.length && <p className="mt-2 text-sm">Коммитов с неполной статистикой: {result.commitsWithIncompleteStats.length}. Неизвестное число строк не считается нулём.</p>}
    </Panel>
    <Panel title="Флаги и основания">
      {flags.length ? flags.map((flag, index) => <article className="border-b border-line py-3" key={`${flag.kind}-${flag.userId}-${index}`}>
        <Badge tone={flag.severity === 'risk' ? 'danger' : 'warning'}>{flag.userId ? name(flag.userId) : 'Команда'}</Badge>
        <p className="mt-2 text-sm">{flag.explanation}</p><p className="mt-1 text-xs muted">Значение: {number(flag.actual)}; порог: {number(flag.threshold)} {flag.unit === 'days' ? 'дн.' : flag.unit === 'percent' ? '%' : 'событий'}</p>
        <Evidence teamId={team.id} ids={flag.evidenceEventIds} />
      </article>) : <p className="text-sm muted">По выбранному периоду флагов нет.</p>}
    </Panel>
    {adjustments.length > 0 && <Panel title="Корректировки кода">{adjustments.map((item, index) => <article key={index} className="border-b border-line py-3 text-sm">
      <p>{item.explanation}{item.path ? ` · ${item.path}` : ''}</p><p className="text-xs muted">Строк: {item.lines === null ? 'неизвестно (доступны только пути файлов)' : item.lines}</p>
      <Evidence teamId={team.id} ids={item.eventIds} /></article>)}</Panel>}
  </>
}
export function TeamAnalytics({ project, team, summaries = false, report = false, memberId }: { project: LiveProject; team: LiveTeam; summaries?: boolean; report?: boolean; memberId?: string }) {
  const query = useAnalytics(team.id), [period, setPeriod] = useState('project')
  const refresh = useApiMutation(() => api.refreshAnalytics(team.id))
  const data = query.data, result = period === 'project' ? data?.project : data?.weeks.find(week => week.weekStartsOn === period)?.result
  const canRefresh = Boolean(data && data.sourceStatus === 'complete' && (!data.manualAvailableAt || Date.parse(data.manualAvailableAt) <= query.dataUpdatedAt))
  return <section className={`space-y-5${report ? ' api-analytics-report' : ''}`} aria-label={`Аналитика ${team.name}`}>
    <Panel title={`Аналитика · ${team.name}`}>
      <p role="status">{data ? statuses[data.status] : query.isPending ? 'Загружаем аналитику…' : 'Аналитика недоступна'}</p>
      <ErrorMessage error={query.error} /><ErrorMessage error={refresh.error} />
      {data?.computedAt && <p className="mt-2 text-xs muted">Рассчитано: {new Date(data.computedAt).toLocaleString('ru-RU')} · версия данных {data.sourceVersion} · модуль {data.engineVersion}</p>}
      {data?.stale && data.project && <p className="mt-2 text-sm" role="status">Показан предыдущий расчёт — данные устарели.</p>}
      <div className="mt-3 flex flex-wrap gap-3">
        {team.canConnect && <Button variant="outline" disabled={!canRefresh || refresh.isPending} onClick={() => refresh.mutate()}>Обновить расчёт</Button>}
        {report && data?.project && <Button variant="outline" onClick={() => window.print()}>Печать / PDF</Button>}
      </div><p className="mt-2 text-xs muted">Автоматически после изменений и ежедневно. Ручное обновление — раз в час.</p>
    </Panel>
    {!summaries && data?.project && <>
      {!report && <label className="field">Период расчёта<select aria-label="Период расчёта" value={period} onChange={event => setPeriod(event.target.value)}><option value="project">Весь проект</option>
        {data.weeks.map(week => <option key={week.weekStartsOn} value={week.weekStartsOn}>Неделя с {date(week.weekStartsOn)}</option>)}</select></label>}
      {result && <Result project={project} team={team} result={result} memberId={memberId} />}
      {!memberId && <ActivityChart title="Баллы по неделям" allowDecimals members={team.memberships.filter(member => member.role === 'participant').map((member, index) => ({ id: member.user.id, name: member.user.name ?? member.user.githubLogin, color: palette[index % palette.length] }))}
        weeks={[...data.weeks].reverse().map(week => ({ label: date(week.weekStartsOn), values: Object.fromEntries(week.result.members.map(member => [member.userId, Number(member.totalPoints.toFixed(3))])) }))} />}
    </>}
    {(summaries || report) && data && <Panel title="Недельные сводки">
      {!data.weeks.length && <p>Сводки появятся после завершения загрузки истории и первого расчёта.</p>}
      {data.weeks.map(week => <article key={week.weekStartsOn} className="border-b border-line py-4">
        <h3 className="mb-2">Неделя с {date(week.weekStartsOn)}</h3><Badge>{week.summary.source === 'ai' ? `ИИ · ${week.summary.provider ?? 'провайдер'}` : 'По шаблону'}</Badge>
        {Date.parse(week.weekStartsOn) + 7 * 86400000 > Date.parse(data.computedAt ?? '') && <p className="mt-2 text-xs muted">Предварительная сводка: неделя ещё не завершена на момент расчёта.</p>}
        <p className="mt-3 whitespace-pre-line text-sm">{week.summary.text}</p><Evidence teamId={team.id} ids={week.summary.evidenceEventIds} />
      </article>)}
    </Panel>}
  </section>
}
