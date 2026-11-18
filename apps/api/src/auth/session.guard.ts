import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuthService } from './auth.service'
import { AuthRequest, cookie, csrfToken, matches, sessionCookie } from './security'

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>('public', [context.getHandler(), context.getClass()])) return true
    const req = context.switchToHttp().getRequest<AuthRequest>()
    const value = cookie(req, sessionCookie)
    const user = await this.auth.session(value)
    if (!user) throw new UnauthorizedException('Sign in required')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const expectedOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173'
      const csrf = req.get('X-CSRF-Token') ?? ''
      if (req.get('Origin') !== expectedOrigin || !matches(csrf, csrfToken(value))) {
        throw new ForbiddenException('Invalid request origin or CSRF token')
      }
    }
    req.user = user
    req.sessionToken = value
    return true
  }
}
