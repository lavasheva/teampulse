import type { Team } from '@teampulse/shared'
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Panel } from './ui'

type ActivityData = Pick<Team, 'weeks' | 'members'>

export function ActivityChart({ members, weeks }: ActivityData) {
  return <Panel title="Активность по неделям">
    {weeks.length ? <>
      <div className="h-64 min-w-0" data-testid="weekly-chart">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={weeks} accessibilityLayer margin={{ left: 0, right: 12, top: 4 }}>
            <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={{ stroke: '#e6e8ef' }} />
            <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={32} />
            <Tooltip />
            <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 12 }} />
            {members.map(member => <Bar key={member.id} name={member.name} dataKey={week => week.values[member.id] ?? 0} fill={member.color} stackId="activity" maxBarSize={42} isAnimationActive={false} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-xs muted">
        <summary className="cursor-pointer">Данные графика</summary>
        <div className="table-scroll"><table>
          <thead><tr><th scope="col">Неделя</th>{members.map(member => <th scope="col" key={member.id}>{member.name}</th>)}</tr></thead>
          <tbody>{weeks.map(week => <tr key={week.label}><th scope="row">{week.label}</th>{members.map(member => <td key={member.id}>{week.values[member.id] ?? 0}</td>)}</tr>)}</tbody>
        </table></div>
      </details>
    </> : <p className="muted">Пока нет активности для графика.</p>}
  </Panel>
}
