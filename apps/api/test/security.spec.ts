import { cookie, csrfToken, hash, matches, setCookie, token } from '../src/auth/security'
import type { Request, Response } from 'express'

describe('session security', () => {
  it('generates random tokens and hashes them', () => {
    const value = token()
    expect(value).toMatch(/^[\w-]{43}$/)
    expect(token()).not.toBe(value)
    expect(hash(value)).not.toBe(value)
    expect(csrfToken(value)).not.toBe(hash(value))
  })
  it('rejects duplicate and malformed cookies', () => {
    const value = token()
    const read = (header: string) => cookie({ headers: { cookie: header } } as Request, 'tp_session')
    expect(read(`other=x; tp_session=${value}`)).toBe(value)
    expect(read(`tp_session=${value}; tp_session=${value}`)).toBe('')
    expect(read('tp_session=bad')).toBe('')
  })
  it('compares untrusted Unicode safely', () => {
    expect(matches('😀'.repeat(32), 'x'.repeat(64))).toBe(false)
    expect(matches('abc', 'abc')).toBe(true)
    expect(matches('abc', 'abd')).toBe(false)
  })
  it('sets Secure and HttpOnly session cookies in production', () => {
    const previous = process.env.NODE_ENV
    const write = jest.fn()
    try {
      process.env.NODE_ENV = 'production'
      setCookie({ cookie: write } as unknown as Response, 'tp_session', token(), 1000)
      expect(write.mock.calls[0][2]).toMatchObject({ secure: true, httpOnly: true, sameSite: 'lax', path: '/api' })
    } finally { process.env.NODE_ENV = previous }
  })
})
