import type { Repository } from '@prisma/client'
import { HistorySource, GitHubAccessError, GitHubRateLimit, rateLimitRetry, type HistoryCursor } from '../src/github/history.source'
import { GitHubAppClient } from '../src/github/app.client'
import { weekStart } from '../src/github/event.store'

describe('resumable GitHub history source', () => {
  const repository = { id: 'repo', fullName: 'owner/repo', externalId: '123', installationId: '456' } as Repository
  const anchor = '2026-11-18T12:00:00.000Z'
  const request = jest.fn()
  const source = new HistorySource({ installationClient: async () => ({ request }) } as unknown as GitHubAppClient)
  const enriched = jest.fn().mockResolvedValue(false)
  beforeEach(() => { request.mockReset(); enriched.mockReset().mockResolvedValue(false) })
  it('distinguishes revoked access from rate limiting and temporary failures', async () => {
    for (const status of [401, 403, 404]) {
      request.mockRejectedValueOnce({ status })
      await expect(source.next(repository, { stage: 'repository', anchor }, enriched)).rejects.toBeInstanceOf(GitHubAccessError)
    }
    request.mockRejectedValueOnce({ status: 503, message: 'upstream secret' })
    await expect(source.next(repository, { stage: 'repository', anchor }, enriched)).rejects.toThrow('GitHub history request failed')
  })

  it('honors primary/secondary rate limits and does not treat an ordinary 403 as rate limiting', async () => {
    const now = 100000
    expect(rateLimitRetry(429, { 'retry-after': '120' }, now)?.getTime()).toBe(220000)
    expect(rateLimitRetry(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '300' }, now)?.getTime()).toBe(301000)
    expect(rateLimitRetry(403, {}, now)).toBeNull()
    request.mockRejectedValue({ status: 429, response: { headers: { 'retry-after': '60' } } })
    await expect(source.next(repository, { stage: 'branches', anchor, page: 1, heads: [] }, enriched)).rejects.toBeInstanceOf(GitHubRateLimit)
  })

  it('fixes branch heads and paginates them without duplicates', async () => {
    request.mockResolvedValueOnce({ data: [{ commit: { sha: 'a' } }, { commit: { sha: 'b' } }], headers: { link: '<next>; rel="next"' } })
    const first = await source.next(repository, { stage: 'branches', anchor, page: 1, heads: [] }, enriched)
    expect(first.cursor).toMatchObject({ stage: 'branches', page: 2, heads: ['a', 'b'] })
    request.mockResolvedValueOnce({ data: [{ commit: { sha: 'b' } }], headers: {} })
    expect((await source.next(repository, first.cursor!, enriched)).cursor).toMatchObject({ stage: 'commits', heads: ['a', 'b'], branchIndex: 0 })
  })

  it('skips enriched commits shared between branches without another GitHub request', async () => {
    enriched.mockResolvedValue(true)
    const after: HistoryCursor = { stage: 'issues', anchor, page: 1 }
    const result = await source.next(repository, { stage: 'commitBatch', anchor, shas: ['sha'], index: 0, after }, enriched)
    expect(result.cursor).toMatchObject({ stage: 'commitBatch', index: 1 })
    expect(request).not.toHaveBeenCalled()
  })

  it('checkpoints paginated file statistics and never copies patches into cursor/events', async () => {
    const commit = { sha: 'a'.repeat(40), html_url: 'https://github.com/o/r/commit/a', author: { id: 1, login: 'author' },
      commit: { message: 'Change', author: { email: 'AUTHOR@EXAMPLE.COM', date: anchor }, committer: { date: anchor } },
      stats: { additions: 4, deletions: 1, total: 5 }, files: [{ filename: 'first.ts', status: 'modified', additions: 3,
        deletions: 1, changes: 4, patch: 'SECRET CODE' }] }
    request.mockResolvedValueOnce({ data: commit, headers: { link: '<next>; rel="next"' } })
    const after: HistoryCursor = { stage: 'issues', anchor, page: 1 }
    const first = await source.next(repository, { stage: 'commit', anchor, sha: commit.sha, page: 1, files: [], after }, enriched)
    expect(first.events).toEqual([])
    expect(first.cursor).toMatchObject({ stage: 'commit', page: 2 })
    expect(JSON.stringify(first)).not.toContain('SECRET CODE')
    request.mockResolvedValueOnce({ data: { ...commit, files: [{ filename: 'second.ts', status: 'added', additions: 1, deletions: 0, changes: 1 }] }, headers: {} })
    const second = await source.next(repository, first.cursor!, enriched)
    expect(second.cursor).toEqual(after)
    expect(second.events[0].author).toMatchObject({ email: 'author@example.com', githubId: '1' })
    expect(second.events[0].details).toMatchObject({ stats: { total: 5 }, files: [{ filename: 'first.ts' }, { filename: 'second.ts' }] })
  })

  it('imports PR opening and merging with the webhook keys, followed by reviews', async () => {
    request.mockResolvedValueOnce({ data: [{ id: 7, number: 2, title: 'Pull', html_url: 'https://github.com/o/r/pull/2',
      user: { id: 1, login: 'member' }, created_at: '2026-11-17T12:00:00Z', closed_at: anchor, merged_at: anchor }], headers: {} })
    const result = await source.next(repository, { stage: 'pulls', anchor, page: 1 }, enriched)
    expect(result.events.map(e => e.externalId)).toEqual(['pr_opened:7', 'pr_merged:7'])
    expect(result.cursor).toMatchObject({ stage: 'reviews', pulls: [{ number: 2 }] })
    request.mockResolvedValueOnce({ data: [{ id: 8, user: { id: 2, login: 'reviewer' }, submitted_at: anchor,
      html_url: 'https://github.com/o/r/pull/2#review', state: 'APPROVED', body: 'not stored' }], headers: {} })
    const reviews = await source.next(repository, result.cursor!, enriched)
    expect(reviews.events[0]).toMatchObject({ externalId: 'review:8', details: { reviewState: 'APPROVED', hasBody: true } })
    expect(JSON.stringify(reviews)).not.toContain('not stored')
  })

  it('does not duplicate PRs from the issues endpoint or invent a closing actor', async () => {
    const issue = { id: 9, title: 'Task', html_url: 'https://github.com/o/r/issues/3', user: { id: 1, login: 'member' },
      created_at: '2026-11-17T12:00:00Z', closed_at: anchor, assignees: [{ id: 1, login: 'member' }] }
    request.mockResolvedValueOnce({ data: [issue, { ...issue, id: 10, pull_request: {} }], headers: {} })
    const result = await source.next(repository, { stage: 'issues', anchor, page: 1 }, enriched)
    expect(result.events).toHaveLength(2)
    expect(result.events[1].author.githubId).toBeNull()
    expect(result.events[1].details).toEqual({ assigneeGithubIds: ['1'] })
    expect(result.cursor).toBeNull()
  })

  it('uses UTC Monday boundaries for invalidations', () => {
    expect(weekStart(new Date('2026-11-22T23:59:00Z')).toISOString()).toBe('2026-11-16T00:00:00.000Z')
    expect(weekStart(new Date('2026-11-23T00:00:00Z')).toISOString()).toBe('2026-11-23T00:00:00.000Z')
  })
})
