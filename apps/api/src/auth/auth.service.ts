import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { GitHubClient } from './github.client'
import { hash, token } from './security'

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly github: GitHubClient) {}

  async begin() {
    const state = token(), browser = token(), verifier = token()
    const url = this.github.authorizationUrl(state, verifier)
    await this.prisma.oAuthAttempt.deleteMany({ where: { expiresAt: { lte: new Date() } } })
    await this.prisma.oAuthAttempt.create({ data: { stateHash: hash(state), browserHash: hash(browser),
      verifier, expiresAt: new Date(Date.now() + 10 * 60_000) } })
    return { browser, url }
  }

  async finish(state: string, browser: string, code: string, previousToken: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !browser || !code || code.length > 512) {
      throw new UnauthorizedException('Invalid OAuth callback')
    }
    const where = { stateHash: hash(state), browserHash: hash(browser), expiresAt: { gt: new Date() } }
    const attempt = await this.prisma.oAuthAttempt.findFirst({ where })
    if (!attempt) throw new UnauthorizedException('OAuth state expired or invalid')
    // deleteMany is atomic: only one concurrent callback may consume this state.
    const consumed = await this.prisma.oAuthAttempt.deleteMany({ where })
    if (consumed.count !== 1) throw new UnauthorizedException('OAuth state already used')
    const profile = await this.github.profile(code, attempt.verifier)
    const sessionToken = token()
    await this.prisma.$transaction(async tx => {
      const user = await tx.user.upsert({ where: { githubId: profile.githubId }, create: profile, update: profile })
      if (previousToken) await tx.session.deleteMany({ where: { tokenHash: hash(previousToken) } })
      await tx.session.deleteMany({ where: { expiresAt: { lte: new Date() } } })
      await tx.session.create({ data: { userId: user.id, tokenHash: hash(sessionToken),
        expiresAt: new Date(Date.now() + 7 * 86400_000) } })
    })
    return sessionToken
  }

  async session(value: string) {
    if (!value) return null
    const session = await this.prisma.session.findUnique({ where: { tokenHash: hash(value) }, include: { user: true } })
    return session && session.expiresAt > new Date() ? session.user : null
  }

  async logout(value: string) {
    await this.prisma.session.deleteMany({ where: { tokenHash: hash(value) } })
  }
}
