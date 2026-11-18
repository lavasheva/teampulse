import { Controller, Get, HttpCode, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request, Response } from 'express'
import { AuthService } from './auth.service'
import { AuthRequest, clearCookie, cookie, csrfToken, oauthCookie, Public, publicUser, sessionCookie, setCookie } from './security'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Get('github')
  async begin(@Res() res: Response) {
    const { browser, url } = await this.auth.begin()
    setCookie(res, oauthCookie, browser, 10 * 60_000)
    res.setHeader('Cache-Control', 'no-store')
    res.redirect(url)
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Get('github/callback')
  async callback(@Query('state') state: unknown, @Query('code') code: unknown,
    @Req() req: Request, @Res() res: Response) {
    clearCookie(res, oauthCookie)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if (typeof state !== 'string' || typeof code !== 'string') throw new UnauthorizedException('Invalid OAuth callback')
    const value = await this.auth.finish(state, cookie(req, oauthCookie), code, cookie(req, sessionCookie))
    setCookie(res, sessionCookie, value, 7 * 86400_000)
    res.redirect(process.env.WEB_ORIGIN ?? 'http://localhost:5173')
  }

  @Get('me')
  me(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store')
    return { user: publicUser(req.user), csrfToken: csrfToken(req.sessionToken) }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.sessionToken)
    clearCookie(res, sessionCookie)
  }
}
