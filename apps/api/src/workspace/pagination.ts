import { BadRequestException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { z } from 'zod'

const cursorSchema = z.object({ id: z.uuid(), at: z.iso.datetime(), scope: z.string().length(64) }).strict()
export const pageScope = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex')
export function readCursor(value: string | undefined, scope: string) {
  if (!value) return null
  try {
    if (value.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error()
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
    if (cursor.scope !== scope) throw new Error()
    return { id: cursor.id, at: new Date(cursor.at) }
  } catch { throw new BadRequestException('Некорректная страница. Сбросьте фильтры и обновите ленту.') }
}
export const writeCursor = (id: string, at: Date, scope: string) => Buffer.from(JSON.stringify({ id, at: at.toISOString(), scope })).toString('base64url')
