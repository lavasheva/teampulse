import { readConfig } from '../src/config'

const env = { DATABASE_URL: 'postgresql://localhost/teampulse' }

describe('API configuration', () => {
  it('uses local defaults', () => {
    expect(readConfig(env)).toEqual({ port: 3000, host: '127.0.0.1', origin: 'http://localhost:5173' })
  })
  it.each(['0', '-1', '65536', 'NaN', '3000.5'])('rejects invalid port %s', PORT => {
    expect(() => readConfig({ ...env, PORT })).toThrow('PORT')
  })
  it.each(['*', 'https://example.com/path', 'file:///tmp', 'http://localhost:5173/'])('rejects invalid origin %s', WEB_ORIGIN => {
    expect(() => readConfig({ ...env, WEB_ORIGIN })).toThrow()
  })
  it('requires PostgreSQL', () => {
    expect(() => readConfig({ DATABASE_URL: 'mysql://localhost/db' })).toThrow('DATABASE_URL')
  })
  it('requires HTTPS for the production frontend', () => {
    expect(() => readConfig({ ...env, NODE_ENV: 'production' })).toThrow('HTTPS')
    expect(readConfig({ ...env, NODE_ENV: 'production', WEB_ORIGIN: 'https://teampulse.example' }).origin)
      .toBe('https://teampulse.example')
  })
  it('allows only an explicitly configured single proxy hop', () => {
    expect(() => readConfig({ ...env, TRUST_PROXY_HOPS: '1' })).not.toThrow()
    for (const value of ['true', '2', '-1']) expect(() => readConfig({ ...env, TRUST_PROXY_HOPS: value })).toThrow('TRUST_PROXY_HOPS')
  })
})
