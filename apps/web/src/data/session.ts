import { demoUsers } from './fixtures'
import { mutateDemoState } from './mock'

export async function signIn(role: 'manager' | 'participant') {
  const user = demoUsers.find(account => account.role === role)!
  mutateDemoState(state => { state.userId = user.id })
  return user
}

export async function signOut() {
  mutateDemoState(state => { state.userId = null })
}
