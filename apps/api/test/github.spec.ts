import { GitHubClient } from '../src/auth/github.client'
import { createHash } from 'node:crypto'

describe('GitHub OAuth adapter', () => {
  const oldEnv = { ...process.env }
  beforeEach(() => {
    process.env.GITHUB_CLIENT_ID = 'test-client'
    process.env.GITHUB_CLIENT_SECRET = 'test-secret'
    process.env.GITHUB_CALLBACK_URL = 'http://localhost:3000/api/auth/github/callback'
  })
  afterEach(() => { process.env = { ...oldEnv }; jest.restoreAllMocks() })

  it('requests only profile/email scopes and PKCE S256', () => {
    const url = new URL(new GitHubClient().authorizationUrl('state', 'verifier'))
    expect(url.origin).toBe('https://github.com')
    expect(url.searchParams.get('scope')).toBe('read:user user:email')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update('verifier').digest('base64url'))
    expect(url.toString()).not.toContain('test-secret')
  })
  it('exchanges the verifier and accepts only verified email addresses', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'temporary-token' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 123, login: 'member', name: 'Member', avatar_url: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { email: 'bad@example.com', verified: false, primary: true },
        { email: 'OK@EXAMPLE.COM', verified: true, primary: false },
      ])))
    const profile = await new GitHubClient().profile('code', 'verifier')
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).code_verifier).toBe('verifier')
    expect(profile.email).toBeNull()
    expect(profile.verifiedEmails).toEqual(['ok@example.com'])
    expect(profile).not.toHaveProperty('access_token')
  })
  it('does not expose upstream errors or secrets', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('secret-token-in-provider-error'))
    await expect(new GitHubClient().profile('code', 'verifier')).rejects.toThrow('GitHub is unavailable')
  })
  it('fails closed if OAuth has not been configured', () => {
    delete process.env.GITHUB_CLIENT_SECRET
    expect(() => new GitHubClient().authorizationUrl('state', 'verifier')).toThrow('not configured')
  })
})
