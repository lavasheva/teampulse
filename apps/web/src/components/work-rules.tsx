import type { ProjectSettings, WorkKind } from '@teampulse/shared'
import { workLabels } from '../data/fixtures'
import { Badge, Panel } from './ui'

const kinds = Object.keys(workLabels) as WorkKind[]
const rules = [
  { key: 'inactivity', label: 'Тишина', hint: 'Нет активности, пока команда работает', unit: 'дней', max: 365 },
  { key: 'imbalance', label: 'Перекос', hint: 'Доля одного участника в команде из трёх и более', unit: '%', max: 100 },
  { key: 'lateBurst', label: 'Рывок перед дедлайном', hint: 'Доля вклада за три дня до контрольной точки', unit: '%', max: 100 },
  { key: 'excluded', label: 'Подозрение на накрутку', hint: 'Доля незасчитанных изменений', unit: '%', max: 100 },
] as const

export function WorkRules({ settings, update }: { settings: ProjectSettings; update: (changes: Partial<ProjectSettings>) => void }) {
  const sum = kinds.reduce((total, key) => total + settings.weights[key], 0)
  return <div className="space-y-4">
    <Panel title="Веса видов работы" aside={<Badge tone={sum === 100 ? 'success' : 'warning'}>Сумма {sum}%</Badge>}>
      <div className="space-y-3">
        {kinds.map(kind => <label key={kind} className="grid grid-cols-[110px_minmax(0,1fr)_44px] items-center gap-2">
          {workLabels[kind]}
          <input aria-label={'Вес: ' + workLabels[kind]} type="range" value={settings.weights[kind]} min={0} max={100}
            onChange={event => update({ weights: { ...settings.weights, [kind]: event.currentTarget.valueAsNumber } })} />
          <span className="text-right">{settings.weights[kind]}%</span>
        </label>)}
      </div>
    </Panel>
    <Panel title="Пороги флагов">
      <div className="divide-y divide-line">{rules.map(rule => <label key={rule.key} className="grid grid-cols-[minmax(0,1fr)_70px_30px] items-center gap-2 py-3">
        <span>{rule.label}<small className="block font-normal muted">{rule.hint}</small></span>
        <input aria-label={rule.label} type="number" required min={1} max={rule.max}
          value={Number.isFinite(settings.thresholds[rule.key]) ? settings.thresholds[rule.key] : ''}
          onChange={event => update({ thresholds: { ...settings.thresholds, [rule.key]: event.currentTarget.valueAsNumber } })} />
        <span className="text-xs muted">{rule.unit}</span>
      </label>)}</div>
    </Panel>
  </div>
}
