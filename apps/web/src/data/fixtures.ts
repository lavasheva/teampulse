import type { DemoUser, Member, Project, ProjectSettings, Team, TeamFlag, WeeklySummary } from '@teampulse/shared'

export const demoUsers: DemoUser[] = [
  { id: 'elena', name: 'Елена Викторовна', role: 'manager' },
  { id: 'ilya', name: 'Илья Фёдоров', role: 'participant' },
]

export const workLabels = {
  code: 'Код',
  pullRequests: 'Pull requests',
  reviews: 'Ревью',
  issues: 'Задачи',
} as const

export const excludedLabels = {
  inactivity: 'Тишина',
  imbalance: 'Перекос',
  lateBurst: 'Рывок перед дедлайном',
  excluded: 'Подозрение на накрутку',
  unknown: 'Неопознанные коммиты',
} as const

export function projectDefaults(name: string, startsOn: string, endsOn: string): ProjectSettings {
  return {
    name, startsOn, endsOn, milestones: [],
    weights: { code: 40, pullRequests: 20, reviews: 20, issues: 20 },
    thresholds: { inactivity: 7, imbalance: 60, lateBurst: 50, excluded: 50 },
  }
}

const colors = ['#5746dd', '#2d8ca8', '#a66b10', '#3e9770']
const firstTeamMembers: Member[] = [
  { id: 'anna', name: 'Анна Котова', handle: 'anna-kot', color: colors[0], share: 61,
    work: { code: 64, pullRequests: 11, reviews: 6, issues: 14 }, activeDays: 27, lastActive: '2026-10-11',
    highlights: ['Авторизация через GitHub', 'Экран расписания на неделю'],
    exclusions: [{ title: 'Сгенерированный lock-файл', lines: 980 }] },
  { id: 'ilya', name: 'Илья Фёдоров', handle: 'ilya-fed', color: colors[1], share: 31,
    work: { code: 30, pullRequests: 5, reviews: 9, issues: 7 }, activeDays: 19, lastActive: '2026-10-10',
    highlights: ['API заданий и дедлайнов', 'Ревью экрана расписания'],
    exclusions: [{ title: 'Переформатирование без смысловых изменений', lines: 260 }] },
  { id: 'petr', name: 'Пётр Смирнов', handle: 'petr-sm', color: colors[2], share: 8,
    work: { code: 6, pullRequests: 1, reviews: 0, issues: 2 }, activeDays: 5, lastActive: '2026-09-29',
    highlights: ['Вёрстка профиля', 'Ветка notifications'], exclusions: [] },
]

const weekLabels = ['1–7.09', '8–14.09', '15–21.09', '22–28.09', '29.09–5.10', '6–11.10']
const firstTeam: Team = {
  id: 'kodzilla', name: 'Кодзилла', repository: 'lumor9/teampulse',
  repositoryUrl: 'https://github.com/lumor9/teampulse', balance: 0.43, members: firstTeamMembers,
  weeks: weekLabels.map((label, index) => ({
    label, values: { anna: [9, 13, 19, 24, 30, 32][index], ilya: [8, 11, 12, 13, 14, 16][index], petr: [5, 4, 2, 1, 0, 0][index] },
  })),
  events: [
    { id: 'pr-34', actorId: 'anna', kind: 'pullRequest', title: 'Приняла pull request #34 «Экран расписания на неделю»', date: '2026-10-11T15:00:00Z' },
    { id: 'review-34', actorId: 'ilya', kind: 'review', title: 'Оставил ревью с 4 комментариями к #34', date: '2026-10-11T12:00:00Z' },
    { id: 'issue-21', actorId: 'ilya', kind: 'issue', title: 'Закрыл задачу #21 «API для заданий»', date: '2026-10-10T10:00:00Z' },
    { id: 'unknown-1', actorId: null, kind: 'commit', title: 'a413be7 · Обновление зависимостей', date: '2026-10-09T18:00:00Z' },
    { id: 'commit-28', actorId: 'petr', kind: 'commit', title: 'Создал ветку notifications', date: '2026-09-29T14:00:00Z' },
  ],
  flags: [
    { id: 'quiet-petr', kind: 'inactivity', severity: 'risk', title: 'Тишина', detail: 'Пётр С. не проявлял активности 12 дней, пока команда работала. Последнее действие — 29 сентября.', memberId: 'petr', date: '2026-10-06' },
    { id: 'share-anna', kind: 'imbalance', severity: 'risk', title: 'Перекос', detail: 'Анна К. даёт 61% вклада при пороге 60% для команды из 3 человек.', memberId: 'anna', date: '2026-10-08' },
    { id: 'missing-kodzilla', kind: 'unknown', severity: 'warning', title: 'Неопознанный коммит', detail: 'Один коммит пока не привязан к участнику.', date: '2026-10-09' },
  ],
}

interface ExampleTeam {
  id: string
  name: string
  repository: string
  balance: number
  people: [string, number][]
  flag?: Pick<TeamFlag, 'kind' | 'title' | 'detail'>
}

function sampleTeam({ id, name, repository, balance, people, flag }: ExampleTeam): Team {
  const members: Member[] = people.map(([person, share], index) => ({
    id: id + '-' + index, name: person, handle: id + '-' + (index + 1), color: colors[index], share,
    work: { code: share, pullRequests: 7 - index, reviews: 4 + index, issues: 8 - index },
    activeDays: 18 - index, lastActive: '2026-10-10', highlights: ['Работа в репозитории команды'], exclusions: [],
  }))
  return {
    id, name, repository, balance, members,
    weeks: weekLabels.map((label, index) => ({ label, values: Object.fromEntries(members.map(member => [member.id, Math.round(member.share * (index + 1) / 18)])) })),
    events: [{ id: id + '-pr', actorId: members[0].id, kind: 'pullRequest', title: 'Принят pull request «Обновление проекта»', date: '2026-10-10T15:00:00Z' }],
    flags: flag ? [{ ...flag, id: id + '-flag', severity: 'warning', date: '2026-10-10' }] : [],
  }
}

const teams = [
  firstTeam,
  sampleTeam({ id: '404', name: '404 Not Found', repository: '404/liferec-bot', balance: 0.07, people: [['Максим Левин', 38], ['Дарья Белова', 35], ['Олег Власов', 27]], flag: { kind: 'inactivity', title: 'Тишина', detail: 'В команде почти не было новых событий 5 дней.' } }),
  sampleTeam({ id: 'bytes', name: 'Байтики', repository: 'baytiki/campus-market', balance: 0.13, people: [['Софья Романова', 34], ['Артём Зотов', 30], ['Никита Громов', 21], ['Вера Данилова', 15]], flag: { kind: 'unknown', title: 'Неопознанные коммиты', detail: 'Часть коммитов сделана с незнакомого аккаунта.' } }),
  sampleTeam({ id: 'syntax', name: 'Синтаксис', repository: 'syntax/room-booking', balance: 0.03, people: [['Кирилл Лебедев', 36], ['Алина Шатова', 33], ['Тимур Наумов', 31]] }),
  sampleTeam({ id: 'pixel', name: 'Пиксель', repository: 'pixel/event-tickets', balance: 0.08, people: [['Полина Ершова', 40], ['Глеб Орлов', 32], ['Мария Сомова', 28]] }),
  sampleTeam({ id: 'friday', name: 'Деплой в пятницу', repository: 'deploy-friday/city-api', balance: 0.04, people: [['Егор Павлов', 28], ['Лиза Чернова', 26], ['Рома Усов', 24], ['Ксюша Фомина', 22]] }),
]

const weeklyLabels = ['5–11 окт', '28 сен – 4 окт', '21–27 сен', '14–20 сен', '7–13 сен', '1–6 сен']
const summaries: WeeklySummary[] = weeklyLabels.map((label, index) => ({
  id: String(index + 1), label,
  text: index === 0 ? 'Неделя активная. Пять из шести команд работали. Стоит обсудить тишину в команде «Кодзилла» и проверить авторов коммитов у «Байтиков».' : 'Команды работали над функциями проекта, оставляли ревью и закрывали задачи.',
  teamTexts: Object.fromEntries(teams.map(team => [team.id, team.id === firstTeam.id && index === 0
    ? 'Анна доделала авторизацию через GitHub и экран расписания (#34). Илья закрыл API заданий и оставил ревью. Пётр не появлялся с 29 сентября. Стоит обсудить, кто возьмёт уведомления.'
    : 'Команда обновила проект, провела ревью и распределила задачи на следующую неделю.'])),
  eventCount: 214 - index * 17, activeMembers: 18 - index, merged: 31 - index * 2,
}))

function exampleProject(id: string, name: string, organization: string, status: Project['status'] = 'active'): Project {
  return {
    id, inviteCode: id + '-2026', organization, owner: demoUsers[0].name, status,
    settings: projectDefaults(name, '2026-09-01', '2026-12-22'),
    teams: [], summaries: [], sendTeamSummaries: true,
  }
}

const project = exampleProject('web', 'Веб-разработка, осень 2026', 'Кафедра программной инженерии')
project.settings.milestones = [
  { id: 'mvp', title: 'MVP', date: '2026-11-01' },
  { id: 'preview', title: 'Предзащита', date: '2026-12-06' },
  { id: 'defense', title: 'Защита', date: '2026-12-22' },
]
project.teams = teams
project.summaries = summaries

export const demoProjects = [
  project,
  { ...exampleProject('db', 'Базы данных, осень 2026', 'Кафедра программной инженерии'), teams: [teams[3], teams[4]] },
  { ...exampleProject('city', 'Хакатон «Код города»', 'ИТ-кластер города', 'complete'), teams: [teams[5]] },
]
