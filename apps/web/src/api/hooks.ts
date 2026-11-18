import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from './client'

export const sessionKey = ['api', 'session'] as const
export const workspaceKey = ['api', 'workspace'] as const
export function useSession() { return useQuery({ queryKey: sessionKey, queryFn: api.session, retry: false }) }
export function useLiveWorkspace() {
  const session = useSession()
  return useQuery({ queryKey: workspaceKey, queryFn: api.workspace, enabled: Boolean(session.data), refetchInterval: 15000, retry: false })
}
export function useApiMutation<Result, Input>(mutationFn: (input: Input) => Promise<Result>) {
  const queries = useQueryClient()
  return useMutation({ mutationFn, onSuccess: () => queries.invalidateQueries({ queryKey: ['api'] }),
    onError: error => { if (error instanceof ApiError && error.status === 401) {
      queries.removeQueries({ queryKey: workspaceKey }); queries.setQueryData(sessionKey, null)
    } } })
}
