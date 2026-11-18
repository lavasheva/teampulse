import { z } from 'zod'
import type { EventKind } from '@prisma/client'

const id = z.number().int().positive().safe()
const user = z.object({ id, login: z.string().min(1).max(100) })
const date = z.iso.datetime({ offset: true })
const title = z.string().transform(value => value.slice(0, 10000))
const base = z.object({ installation: z.object({ id }), repository: z.object({ id }) })
export interface NormalizedEvent {
  externalId: string; kind: EventKind; occurredAt: string
  author: { key: string; login: string | null; email: string | null; githubId: string | null }
  payload: { title: string; url: string; files?: { added: string[]; removed: string[]; modified: string[] } }
}
export interface DeliveryPayload {
  installationId: string; repositoryExternalId?: string
  events: NormalizedEvent[]; disconnect?: 'installation' | string[]
}
const actor = (value: z.infer<typeof user>): NormalizedEvent['author'] => ({
  key: `github:${value.id}`, login: value.login, email: null, githubId: String(value.id),
})

// Allowlisted metadata only: no source code, diffs or arbitrary upstream properties.
export function normalize(event: string, input: unknown): DeliveryPayload | null {
  if (event === 'installation') {
    const p = z.object({ action: z.string(), installation: z.object({ id }) }).parse(input)
    return ['deleted', 'suspend'].includes(p.action)
      ? { installationId: String(p.installation.id), events: [], disconnect: 'installation' } : null
  }
  if (event === 'installation_repositories') {
    const p = z.object({ action: z.string(), installation: z.object({ id }),
      repositories_removed: z.array(z.object({ id })).default([]) }).parse(input)
    return p.action === 'removed' ? { installationId: String(p.installation.id), events: [],
      disconnect: p.repositories_removed.map(r => String(r.id)) } : null
  }
  if (!['push', 'pull_request', 'pull_request_review', 'issues'].includes(event)) return null
  const p = base.parse(input)
  const result: DeliveryPayload = { installationId: String(p.installation.id),
    repositoryExternalId: String(p.repository.id), events: [] }
  if (event === 'push') {
    const author = z.object({ email: z.string().max(320).nullish(), username: z.string().max(100).nullish() })
    const paths = z.array(z.string().max(4096)).max(10000).default([])
    const commit = z.object({ id: z.string().regex(/^[a-f0-9]{40,64}$/), message: title,
      timestamp: date, url: z.string().url(), author, added: paths, removed: paths, modified: paths })
    const push = z.object({ commits: z.array(commit).max(2048) }).parse(input)
    result.events = push.commits.map(c => {
      const email = c.author.email?.trim().toLowerCase() || null
      return { externalId: `commit:${c.id}`, kind: 'commit', occurredAt: c.timestamp,
        // The push author has no verified numeric GitHub ID. Never identify by login alone.
        author: { key: email ? `email:${email}` : `unknown:${c.id}`, email, login: c.author.username ?? null, githubId: null },
        payload: { title: c.message, url: c.url, files: { added: c.added, removed: c.removed, modified: c.modified } } }
    })
  } else if (event === 'pull_request') {
    const p = z.object({ action: z.string(), pull_request: z.object({ id, title, html_url: z.string().url(),
      user, created_at: date, closed_at: date.nullable(), merged_at: date.nullable() }) }).parse(input)
    if (!['opened', 'closed'].includes(p.action)) return null
    const pr = p.pull_request
    const kind = p.action === 'opened' ? 'pr_opened' : pr.merged_at ? 'pr_merged' : 'pr_closed'
    result.events = [{ externalId: `${kind}:${pr.id}`, kind, author: actor(pr.user),
      occurredAt: p.action === 'opened' ? pr.created_at : pr.merged_at ?? pr.closed_at ?? pr.created_at,
      payload: { title: pr.title, url: pr.html_url } }]
  } else if (event === 'pull_request_review') {
    const p = z.object({ action: z.string(), review: z.object({ id, user, submitted_at: date,
      html_url: z.string().url() }), pull_request: z.object({ title }) }).parse(input)
    if (p.action !== 'submitted') return null
    result.events = [{ externalId: `review:${p.review.id}`, kind: 'review', author: actor(p.review.user),
      occurredAt: p.review.submitted_at, payload: { title: p.pull_request.title, url: p.review.html_url } }]
  } else {
    const p = z.object({ action: z.string(), sender: user, issue: z.object({ id, title, user,
      created_at: date, closed_at: date.nullable(), html_url: z.string().url() }) }).parse(input)
    if (!['opened', 'closed'].includes(p.action)) return null
    const issue = p.issue, kind = p.action === 'opened' ? 'issue_opened' : 'issue_closed'
    result.events = [{ externalId: `${kind}:${issue.id}:${p.action === 'opened' ? issue.created_at : issue.closed_at}`,
      kind, author: actor(p.action === 'opened' ? issue.user : p.sender),
      occurredAt: p.action === 'opened' ? issue.created_at : issue.closed_at ?? issue.created_at,
      payload: { title: issue.title, url: issue.html_url } }]
  }
  return result
}
