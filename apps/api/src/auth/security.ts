import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Request, Response } from 'express'
import type { User } from '@prisma/client'
import { SetMetadata } from '@nestjs/common'

export const Public = () => SetMetadata('public', true)
export const token = () => randomBytes(32).toString('base64url')
export const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export const csrfToken = (value: string) => hash(`csrf:${value}`)
export function matches(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
export function cookie(req: Request, name: string) {
  const values = (req.headers.cookie ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${name}=`))
  if (values.length !== 1) return ''
  const value = values[0].slice(name.length + 1)
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : ''
}
export function setCookie(res: Response, name: string, value: string, maxAge: number) {
  res.cookie(name, value, { httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', path: '/api', maxAge })
}
export function clearCookie(res: Response, name: string) {
  res.clearCookie(name, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api' })
}
export const sessionCookie = 'tp_session'
export const oauthCookie = 'tp_oauth'
export interface AuthRequest extends Request { user: User; sessionToken: string }
export function publicUser(user: User) {
  return { id: user.id, githubLogin: user.githubLogin, name: user.name, avatarUrl: user.avatarUrl }
}
