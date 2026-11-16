import { getDemoUser, mutateDemoState } from './mock'

export async function confirmCommitAuthor(input: { projectId: string; teamId: string; eventId: string }) {
  mutateDemoState(state => {
    const user = getDemoUser(state)
    if (user?.role !== 'participant' || state.assignments[input.projectId] !== input.teamId) {
      throw new Error('Подтвердить авторство может участник этой команды.')
    }
    const project = state.projects.find(item => item.id === input.projectId)
    const team = project?.teams.find(item => item.id === input.teamId)
    const event = team?.events.find(item => item.id === input.eventId && item.kind === 'commit')
    if (!team || !event || !team.members.some(member => member.id === user.id)) throw new Error('Коммит недоступен.')
    if (event.actorId && event.actorId !== user.id) throw new Error('У коммита уже есть другой автор.')
    event.actorId = user.id
    if (team.events.every(item => item.kind !== 'commit' || item.actorId !== null)) {
      team.flags.filter(flag => flag.kind === 'unknown').forEach(flag => { flag.resolved = true })
    }
  })
}
