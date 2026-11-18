import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ApiError } from './api/client'

const queryClient: QueryClient = new QueryClient({ queryCache: new QueryCache({ onError: error => {
  if (error instanceof ApiError && error.status === 401) queryClient.setQueryData(['api', 'session'], null)
} }) })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
