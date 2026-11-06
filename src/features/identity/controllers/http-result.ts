import type { Context } from 'hono'
import type { Unauthorized } from '../domain/errors.ts'
import { HttpStatusCode } from '#/infrastructure/http/http-code.ts'

export function httpFailure(context: Context, error: Unauthorized) {
  return context.json(
    { error: { code: 'UNAUTHORIZED', message: error.message } },
    HttpStatusCode.Unauthorized,
  )
}
