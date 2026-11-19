import { Injectable } from '@nestjs/common'
import type { Repository, Prisma } from '@prisma/client'
import { GitHubAppClient } from './app.client'
import { normalize } from './normalize'
import type { CollectedEvent } from './event.store'

interface Person { id: number; login: string }
const before = (value: string, anchor: string) => Date.parse(value) <= Date.parse(anchor)
interface FileStat { filename: string; status: string; additions: number; deletions: number; changes: number; previousFilename?: string }
interface Commit {
  sha: string; html_url: string; author: Person | null
  commit: { message: string; author: { email: string | null; date: string | null } | null; committer: { date: string | null } | null }
  stats: { additions: number; deletions: number; total: number }; files: {
    filename: string; status: string; additions: number; deletions: number; changes: number; previous_filename?: string
  }[]
}
interface Pull {
  id: number; number: number; title: string; html_url: string; user: Person; created_at: string
  closed_at: string | null; merged_at: string | null; assignees?: Person[]
}
interface Review { id: number; user: Person | null; submitted_at: string | null; html_url: string; state: string; body: string | null }
interface Issue {
  id: number; title: string; html_url: string; user: Person; created_at: string; closed_at: string | null
  closed_by?: Person | null; pull_request?: unknown; assignees?: Person[]
}

export type HistoryCursor =
  | { stage: 'repository'; anchor: string }
  | { stage: 'branches'; anchor: string; page: number; heads: string[] }
  | { stage: 'commits'; anchor: string; heads: string[]; branchIndex: number; page: number }
  | { stage: 'commitBatch'; anchor: string; shas: string[]; index: number; after: HistoryCursor }
  | { stage: 'commit'; anchor: string; sha: string; page: number; files: FileStat[]; metadata?: CollectedEvent; after: HistoryCursor }
  | { stage: 'pulls'; anchor: string; page: number }
  | { stage: 'reviews'; anchor: string; pulls: { number: number; title: string }[]; index: number; page: number; after: HistoryCursor }
  | { stage: 'issues'; anchor: string; page: number }

export interface HistoryStep { cursor: HistoryCursor | null; events: CollectedEvent[]; fullName?: string }
export class GitHubRateLimit extends Error {
  constructor(readonly retryAt: Date) { super('GitHub rate limit') }
}
export class GitHubAccessError extends Error {
  constructor() { super('GitHub repository access unavailable') }
}

export function rateLimitRetry(status: number | undefined, headers: Record<string, string | undefined>, now = Date.now()) {
  if (status !== 403 && status !== 429) return null
  if (status === 403 && !headers['retry-after'] && headers['x-ratelimit-remaining'] !== '0') return null
  const retryAfter = Number(headers['retry-after'])
  const reset = Number(headers['x-ratelimit-reset']) * 1000
  const retry = Number.isFinite(retryAfter) && retryAfter > 0 ? now + retryAfter * 1000
    : headers['x-ratelimit-remaining'] === '0' && reset > now ? reset + 1000 : now + 60000
  return new Date(retry)
}

@Injectable()
export class HistorySource {
  constructor(private readonly github: GitHubAppClient) {}

  private async get<T>(repository: Repository, resource: string, params: Record<string, string | number> = {}) {
    const [owner, repo] = repository.fullName.split('/')
    try {
      const client = await this.github.installationClient(repository.installationId)
      const result = await client.request(`GET ${resource.startsWith('/') ? resource : `/repos/{owner}/{repo}/${resource}`}`, {
        owner, repo, per_page: 100, ...params,
      })
      return { data: result.data as T, next: /rel="next"/.test(result.headers.link ?? '') }
    } catch (error) {
      const failure = error as { status?: number; message?: string; response?: { headers?: Record<string, string> } }
      const retry = rateLimitRetry(failure.status === 403 && /rate limit/i.test(failure.message ?? '') ? 429 : failure.status,
        failure.response?.headers ?? {})
      if (retry) throw new GitHubRateLimit(retry)
      if ([401, 403, 404].includes(failure.status ?? 0)) throw new GitHubAccessError()
      throw new Error('GitHub history request failed')
    }
  }

  async next(repository: Repository, cursor: HistoryCursor, enriched: (sha: string) => Promise<boolean>): Promise<HistoryStep> {
    const { anchor } = cursor
    const envelope = { installation: { id: Number(repository.installationId) }, repository: { id: Number(repository.externalId) } }
    if (cursor.stage === 'repository') {
      const result = await this.get<{ id: number; full_name: string }>(repository, '/repositories/{repository_id}', {
        repository_id: repository.externalId,
      })
      if (String(result.data.id) !== repository.externalId) throw new Error('Repository identity changed')
      return { fullName: result.data.full_name, events: [], cursor: { stage: 'branches', anchor, page: 1, heads: [] } }
    }
    if (cursor.stage === 'branches') {
      const result = await this.get<{ commit: { sha: string } }[]>(repository, 'branches', { page: cursor.page })
      const heads = [...new Set([...cursor.heads, ...result.data.map(branch => branch.commit.sha)])]
      return { events: [], cursor: result.next ? { ...cursor, heads, page: cursor.page + 1 }
        : heads.length ? { stage: 'commits', anchor, heads, branchIndex: 0, page: 1 } : { stage: 'pulls', anchor, page: 1 } }
    }
    if (cursor.stage === 'commits') {
      const result = await this.get<{ sha: string }[]>(repository, 'commits', {
        sha: cursor.heads[cursor.branchIndex], page: cursor.page,
      })
      const after: HistoryCursor = result.next ? { ...cursor, page: cursor.page + 1 }
        : cursor.branchIndex + 1 < cursor.heads.length ? { ...cursor, branchIndex: cursor.branchIndex + 1, page: 1 }
          : { stage: 'pulls', anchor, page: 1 }
      return { events: [], cursor: { stage: 'commitBatch', anchor, shas: result.data.map(c => c.sha), index: 0, after } }
    }
    if (cursor.stage === 'commitBatch') {
      if (cursor.index >= cursor.shas.length) return { events: [], cursor: cursor.after }
      const sha = cursor.shas[cursor.index], after = { ...cursor, index: cursor.index + 1 }
      return { events: [], cursor: await enriched(sha) ? after : { stage: 'commit', anchor, sha, page: 1, files: [], after } }
    }
    if (cursor.stage === 'commit') {
      const result = await this.get<Commit>(repository, 'commits/{ref}', { ref: cursor.sha, page: cursor.page })
      const commit = result.data
      const email = commit.commit.author?.email?.trim().toLowerCase() || null
      const metadata: CollectedEvent = cursor.metadata ?? {
        externalId: `commit:${cursor.sha}`, kind: 'commit', occurredAt: commit.commit.author?.date ?? commit.commit.committer?.date ?? anchor,
        author: { key: email ? `email:${email}` : commit.author ? `github:${commit.author.id}` : `unknown:${cursor.sha}`,
          email, login: commit.author?.login ?? null, githubId: commit.author ? String(commit.author.id) : null },
        payload: { title: commit.commit.message.slice(0, 10000), url: commit.html_url },
        details: { stats: { additions: commit.stats.additions, deletions: commit.stats.deletions, total: commit.stats.total } },
      }
      const files = [...cursor.files, ...commit.files.map(f => ({ filename: f.filename, status: f.status,
        additions: f.additions, deletions: f.deletions, changes: f.changes,
        ...(f.previous_filename ? { previousFilename: f.previous_filename } : {}) }))]
      if (result.next && files.length < 3000) return { events: [], cursor: { ...cursor, page: cursor.page + 1, metadata, files } }
      metadata.details = { ...(metadata.details as object), files, filesTruncated: files.length >= 3000 } as unknown as Prisma.InputJsonValue
      return { events: [metadata], cursor: cursor.after }
    }
    if (cursor.stage === 'pulls') {
      const result = await this.get<Pull[]>(repository, 'pulls', { state: 'all', sort: 'created', direction: 'asc', page: cursor.page })
      const pulls = result.data.filter(p => before(p.created_at, anchor))
      const events: CollectedEvent[] = []
      for (const pull of pulls) {
        events.push(...normalize('pull_request', { ...envelope, action: 'opened', pull_request: pull })!.events)
        if (pull.closed_at && before(pull.closed_at, anchor)) events.push(...normalize('pull_request', {
          ...envelope, action: 'closed', pull_request: pull,
        })!.events)
      }
      const after: HistoryCursor = result.next && pulls.length === result.data.length
        ? { ...cursor, page: cursor.page + 1 } : { stage: 'issues', anchor, page: 1 }
      return { events, cursor: { stage: 'reviews', anchor, pulls: pulls.map(p => ({ number: p.number, title: p.title })), index: 0, page: 1, after } }
    }
    if (cursor.stage === 'reviews') {
      if (cursor.index >= cursor.pulls.length) return { events: [], cursor: cursor.after }
      const pull = cursor.pulls[cursor.index]
      const result = await this.get<Review[]>(repository, 'pulls/{pull_number}/reviews', { pull_number: pull.number, page: cursor.page })
      const events: CollectedEvent[] = result.data.filter(r => r.submitted_at && before(r.submitted_at, anchor)).map(review => ({
        ...normalize('pull_request_review', { ...envelope, action: 'submitted', review, pull_request: pull })!.events[0],
        details: { reviewState: review.state, hasBody: Boolean(review.body?.trim()), pullNumber: pull.number },
      }))
      return { events, cursor: result.next ? { ...cursor, page: cursor.page + 1 } : { ...cursor, index: cursor.index + 1, page: 1 } }
    }
    const result = await this.get<Issue[]>(repository, 'issues', { state: 'all', sort: 'created', direction: 'asc', page: cursor.page })
    const issues = result.data.filter(i => !i.pull_request && before(i.created_at, anchor)), events: CollectedEvent[] = []
    for (const issue of issues) {
      const opened = normalize('issues', { ...envelope, action: 'opened', issue, sender: issue.user })!.events
      const closed = issue.closed_at && before(issue.closed_at, anchor)
        ? normalize('issues', { ...envelope, action: 'closed', issue, sender: issue.closed_by ?? null })!.events : []
      events.push(...[...opened, ...closed].map(event => ({ ...event,
        details: { assigneeGithubIds: (issue.assignees ?? []).map(person => String(person.id)) } })))
    }
    return { events, cursor: result.next && result.data.every(i => before(i.created_at, anchor)) ? { ...cursor, page: cursor.page + 1 } : null }
  }
}
