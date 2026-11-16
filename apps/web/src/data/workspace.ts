import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { loadWorkspace, storageKey } from './mock'

export const workspaceKey = ['demo', 'workspace'] as const

export function useWorkspace() {
  return useQuery({ queryKey: workspaceKey, queryFn: loadWorkspace })
}

export function useWorkspaceStorageEvents() {
  const queryClient = useQueryClient()
  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === storageKey || event.key === null) {
        void queryClient.invalidateQueries({ queryKey: ['demo'] })
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [queryClient])
}

export function useDemoMutation<Result, Input>(mutationFn: (input: Input) => Promise<Result>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['demo'] }),
  })
}

export function useProject() {
  const { projectId } = useParams()
  return useWorkspace().data?.projects.find(project => project.id === projectId)
}

export function useTeam() {
  const project = useProject()
  const { teamId } = useParams()
  return { project, team: project?.teams.find(team => team.id === teamId) }
}
