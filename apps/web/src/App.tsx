import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { WorkspaceLayout } from './components/layout'
import { Invite, Login, Member, NotFound, Overview, Participants, Projects, Report, Settings, Summaries, Team } from './pages'
import { paths } from './routes'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route index element={<Navigate to={paths.projects} replace />} />
        <Route path="login" element={<Login />} />
        <Route path="invite/:code" element={<Invite />} />
        <Route path="projects/:projectId/teams/:teamId/report" element={<Report />} />
        <Route element={<WorkspaceLayout />}>
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:projectId">
            <Route index element={<Overview />} />
            <Route path="participants" element={<Participants />} />
            <Route path="summaries" element={<Summaries />} />
            <Route path="settings" element={<Settings />} />
            <Route path="teams/:teamId" element={<Team />} />
            <Route path="teams/:teamId/members/:memberId" element={<Member />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
