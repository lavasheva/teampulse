import { normalize } from '../src/github/normalize'

const base = { installation: { id: 1 }, repository: { id: 2 } }
const user = { id: 10, login: 'member' }
const date = '2026-11-18T12:00:00Z'

describe('GitHub metadata normalization', () => {
  it('strips arbitrary payload fields and code without trusting the push username', () => {
    const data = normalize('push', { ...base, patch: 'TOP SECRET SOURCE', commits: [{
      id: 'a'.repeat(40), timestamp: date, message: 'Feature', url: 'https://github.com/a/b/commit/a',
      patch: 'TOP SECRET SOURCE', author: { email: 'MEMBER@EXAMPLE.COM', username: 'spoofable' }, modified: ['a.ts'],
    }] })!
    expect(JSON.stringify(data)).not.toContain('TOP SECRET SOURCE')
    expect(data.events[0].author).toMatchObject({ key: 'email:member@example.com', githubId: null })
    expect(data.events[0].externalId).toBe(`commit:${'a'.repeat(40)}`)
  })
  it('gives opening and merging a PR distinct keys and attributes work to its author', () => {
    const pr = { id: 3, title: 'PR', html_url: 'https://github.com/a/b/pull/1', user, created_at: date,
      closed_at: date, merged_at: date }
    const opened = normalize('pull_request', { ...base, action: 'opened', pull_request: pr })!
    const merged = normalize('pull_request', { ...base, action: 'closed', pull_request: pr })!
    expect(opened.events[0].externalId).not.toBe(merged.events[0].externalId)
    expect(merged.events[0].kind).toBe('pr_merged')
    expect(merged.events[0].author.githubId).toBe('10')
  })
  it('normalizes reviews and closed issues', () => {
    expect(normalize('pull_request_review', { ...base, action: 'submitted', pull_request: { title: 'PR' },
      review: { id: 4, user, submitted_at: date, html_url: 'https://github.com/a/b/pull/1#review' } })!.events[0].kind).toBe('review')
    expect(normalize('issues', { ...base, action: 'closed', sender: user,
      issue: { id: 5, title: 'Task', user, created_at: date, closed_at: date, html_url: 'https://github.com/a/b/issues/1' } })!
      .events[0].kind).toBe('issue_closed')
  })
  it('recognizes installation deletion and selective repository removal', () => {
    expect(normalize('installation', { action: 'deleted', installation: { id: 1 } })?.disconnect).toBe('installation')
    expect(normalize('installation_repositories', { action: 'removed', installation: { id: 1 },
      repositories_removed: [{ id: 2 }] })?.disconnect).toEqual(['2'])
  })
  it('ignores unsupported events and rejects malformed supported events', () => {
    expect(normalize('ping', {})).toBeNull()
    expect(() => normalize('push', base)).toThrow()
  })
  it('keeps commits with missing author email as unknown identities', () => {
    const result = normalize('push', { ...base, commits: [{ id: 'b'.repeat(40), timestamp: date,
      message: 'Anonymous author', url: 'https://github.com/a/b/commit/b', author: { email: null } }] })!
    expect(result.events[0].author.key).toBe(`unknown:${'b'.repeat(40)}`)
    expect(result.events[0].author.email).toBeNull()
  })
})
