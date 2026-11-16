import type { DemoUser, Project } from '@teampulse/shared'
import { demoProjects, demoUsers } from './fixtures'

export const storageKey = 'teampulse.demo.v1'

interface DemoState {
  userId: string | null
  projects: Project[]
  assignments: Record<string, string>
}

export interface Workspace {
  user: DemoUser | null
  projects: Project[]
  assignments: Record<string, string>
}

function freshState(): DemoState {
  return { userId: null, projects: structuredClone(demoProjects), assignments: { web: 'kodzilla' } }
}

export function readDemoState(): DemoState {
  const json = localStorage.getItem(storageKey)
  if (!json) return freshState()
  try {
    const state: DemoState = JSON.parse(json)
    if (Array.isArray(state.projects) && state.assignments && 'userId' in state) return state
  } catch {
    return freshState()
  }
  return freshState()
}

export function mutateDemoState<Result>(update: (state: DemoState) => Result): Result {
  const state = readDemoState()
  const result = update(state)
  localStorage.setItem(storageKey, JSON.stringify(state))
  return result
}

export function getDemoUser(state: DemoState) {
  return demoUsers.find(user => user.id === state.userId) ?? null
}

export async function loadWorkspace(): Promise<Workspace> {
  const state = readDemoState()
  const user = getDemoUser(state)
  if (!user) return { user, projects: [], assignments: {} }
  if (user.role === 'manager') return { user, projects: state.projects, assignments: state.assignments }

  const projects = state.projects.flatMap(project => {
    const team = project.teams.find(item => item.id === state.assignments[project.id])
    if (!team) return []
    return [{
      ...project,
      teams: [team],
      summaries: project.summaries.flatMap(summary => {
        const text = summary.teamTexts[team.id]
        if (!text) return []
        return [{
          ...summary, text, teamTexts: { [team.id]: text },
          eventCount: team.events.length,
          activeMembers: team.members.filter(member => member.activeDays > 0).length,
          merged: team.events.filter(event => event.kind === 'pullRequest').length,
        }]
      }),
    }]
  })
  return { user, projects, assignments: state.assignments }
}
