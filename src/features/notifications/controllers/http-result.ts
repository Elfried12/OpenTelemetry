import type { Context } from 'hono'
import type { InvalidInput } from '#/shared-kernel/errors.ts'
import {
  Unauthorized,
  NotFound,
} from '#/features/notifications/domain/errors.ts'
import { HttpStatusCode } from '#/platform/http/http-code.ts'

export function httpFailure(
  context: Context,
  error: InvalidInput | Unauthorized | NotFound,
) {
  if (error instanceof Unauthorized) {
    return context.json(
      { error: { code: 'UNAUTHORIZED', message: error.message } },
      HttpStatusCode.Unauthorized,
    )
  }
  if (error instanceof NotFound) {
    return context.json(
      { error: { code: 'NOT_FOUND', message: error.message } },
      HttpStatusCode.NotFound,
    )
  }
  return context.json(
    { error: { code: 'INVALID_INPUT', message: error.message } },
    HttpStatusCode.BadRequest,
  )
}
