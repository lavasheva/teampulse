import { Link } from 'react-router'
import { Avatar, Button, EmptyState } from '../components/ui'
import { formatDate, formatDay, formatNumber } from '../data/presentation'
import { reportTotals } from '../data/report'
import { useTeam } from '../data/workspace'
import { paths } from '../routes'

export function Report() {
  const { project, team } = useTeam()
  if (!project || !team) return <main className="p-8"><EmptyState title="Отчёт недоступен"><Link to={paths.projects}>Мои проекты</Link></EmptyState></main>

  const totals = reportTotals(project.id, team)
  const participants = team.members.map(member => ({ ...member, totals: totals.members[member.id] ?? { ...member.work, share: member.share, activeDays: member.activeDays } }))
    .sort((a, b) => b.totals.share - a.totals.share)
  const stats = [
    ['Событий за проект', totals.eventCount],
    ['Принятых pull requests', participants.reduce((sum, member) => sum + member.totals.pullRequests, 0)],
    ['Закрытых задач', participants.reduce((sum, member) => sum + member.totals.issues, 0)],
    ['Равномерность', totals.balance],
  ] as const
  const metadata = [
    ['Проект', project.settings.name],
    ['Период', formatDate(project.settings.startsOn) + ' — ' + formatDate(project.settings.endsOn)],
    ['Репозиторий', team.repository || '—'],
    ['Руководитель', project.owner],
  ] as const
  const exclusions = team.members.flatMap(member => member.exclusions).reduce((sum, item) => sum + item.lines, 0)

  return <main className="report-screen">
    <div className="report-toolbar">
      <Link to={paths.team(project.id, team.id)}>← {team.name} / Итоговый отчёт</Link>
      <div className="actions">
        <Button variant="outline" onClick={() => window.print()}>Сохранить как PDF</Button>
        <Button onClick={() => window.print()}>Печать</Button>
      </div>
    </div>
    <article className="report-sheet">
      <header className="mb-6">
        <p className="mb-1 text-xs font-semibold text-brand uppercase">Итоговый отчёт команды</p>
        <h1>{team.name}</h1>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">{metadata.map(([label, value]) => <div key={label}><dt className="font-medium uppercase muted">{label}</dt><dd className="mt-0.5 break-words">{value}</dd></div>)}</dl>
      </header>
      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">{stats.map(([label, value]) => <div key={label} className="rounded-md border border-line p-3">
        <dd className="text-xl font-bold">{formatNumber(value)}</dd><dt className="mt-1 text-xs muted">{label}</dt>
      </div>)}</dl>
      <section className="report-section">
        <h2>Вклад участников</h2>
        {participants.length ? <ul className="divide-y divide-line">{participants.map(member => <li className="report-member" key={member.id}>
          <div>
            <div className="flex items-center gap-2"><Avatar name={member.name} color={member.color} /><strong>{member.name}</strong></div>
            <strong className="mt-2 block text-2xl">{member.totals.share}%</strong><p className="text-xs muted">Активных дней: {member.totals.activeDays}</p>
          </div>
          <div>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Код', member.totals.code + '%'], ['Pull requests', member.totals.pullRequests],
                ['Ревью', member.totals.reviews], ['Задачи', member.totals.issues],
              ].map(([label, value]) => <div className="rounded-md bg-canvas p-2 text-xs" key={label}><dd className="font-semibold">{value}</dd><dt className="muted">{label}</dt></div>)}
            </dl>
            {member.highlights.length > 0 && <p className="mt-3 text-xs leading-relaxed"><strong>Ключевые работы.</strong> {member.highlights.join(' · ')}</p>}
          </div>
        </li>)}</ul> : <p className="py-3 muted">В команде пока нет участников.</p>}
      </section>
      <section className="report-section">
        <h2>История флагов</h2>
        {totals.history.length ? <ol className="space-y-2 py-3 text-xs leading-relaxed">{[...totals.history].sort((a, b) => a.date.localeCompare(b.date)).map(flag => <li key={flag.id}>
          <time className="font-medium" dateTime={flag.date}>{formatDay(flag.date)}</time> · <strong>{flag.title}.</strong> {flag.detail}{flag.resolved && ' Флаг снят.'}
        </li>)}</ol> : <p className="py-3 muted">Флагов за период нет.</p>}
      </section>
      <footer className="rounded-md bg-canvas p-3 text-xs leading-relaxed muted">
        Отчёт учитывает работу в репозитории. Вклад вне репозитория не входит в расчёт. Исключено строк: {formatNumber(exclusions)}.
      </footer>
    </article>
  </main>
}
