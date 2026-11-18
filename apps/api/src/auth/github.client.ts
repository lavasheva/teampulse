import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { createHash } from 'node:crypto'

export function oauthConfig() {
  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET
  const redirectUri = process.env.GITHUB_CALLBACK_URL
  if (!clientId || !clientSecret || !redirectUri) throw new ServiceUnavailableException('GitHub OAuth is not configured')
  const url = new URL(redirectUri)
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/api/auth/github/callback'
    || url.search || url.hash || url.username || url.password
    || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new ServiceUnavailableException('Invalid GitHub callback configuration')
  }
  return { clientId, clientSecret, redirectUri }
}

export interface GitHubProfile {
  githubId: string; githubLogin: string; name: string | null; avatarUrl: string | null
  email: string | null; verifiedEmails: string[]
}

@Injectable()
export class GitHubClient {
  authorizationUrl(state: string, verifier: string) {
    const config = oauthConfig()
    const url = new URL('https://github.com/login/oauth/authorize')
    url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri,
      scope: 'read:user user:email', state, code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString()
    return url.toString()
  }

  async profile(code: string, verifier: string): Promise<GitHubProfile> {
    const config = oauthConfig()
    try {
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret,
          redirect_uri: config.redirectUri, code, code_verifier: verifier }), signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) throw new ServiceUnavailableException('GitHub is unavailable')
      const result = await response.json() as { access_token?: string; error?: string }
      if (!result.access_token || result.error) throw new UnauthorizedException('GitHub authorization rejected')
      const headers = { Authorization: `Bearer ${result.access_token}`, Accept: 'application/vnd.github+json',
        'User-Agent': 'TeamPulse', 'X-GitHub-Api-Version': '2022-11-28' }
      const [userResponse, emailResponse] = await Promise.all([
        fetch('https://api.github.com/user', { headers, signal: AbortSignal.timeout(10000) }),
        fetch('https://api.github.com/user/emails', { headers, signal: AbortSignal.timeout(10000) }),
      ])
      if (!userResponse.ok || !emailResponse.ok) throw new ServiceUnavailableException('GitHub profile is unavailable')
      const user = await userResponse.json() as { id: number; login: string; name: string | null; avatar_url: string | null }
      const emails = await emailResponse.json() as { email: string; verified: boolean; primary: boolean }[]
      if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.login !== 'string' || !Array.isArray(emails)) {
        throw new ServiceUnavailableException('Invalid GitHub response')
      }
      const verified = emails.filter(e => e.verified === true && typeof e.email === 'string')
      return { githubId: String(user.id), githubLogin: user.login, name: user.name, avatarUrl: user.avatar_url,
        email: verified.find(e => e.primary)?.email.toLowerCase() ?? null,
        verifiedEmails: [...new Set(verified.map(e => e.email.toLowerCase()))] }
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ServiceUnavailableException) throw error
      throw new ServiceUnavailableException('GitHub is unavailable')
    }
  }
}
