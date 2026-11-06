import { HttpStatusCode } from '#/platform/http/http-code.ts'
import type { ApplicationError } from '#/features/events/application/ports.ts'
import {
  Conflict,
  NotFound,
  Unauthorized,
} from '#/features/events/domain/errors.ts'
import { presentError } from '#/features/events/presentation/event-presenter.ts'

export function presentApplicationError(error: ApplicationError) {
  if (error instanceof Conflict) {
    return {
      status: HttpStatusCode.Conflict,
      body: presentError('CONFLICT', error.message),
    } as const
  }
  if (error instanceof NotFound) {
    return {
      status: HttpStatusCode.NotFound,
      body: presentError('NOT_FOUND', error.message),
    } as const
  }
  if (error instanceof Unauthorized) {
    return {
      status: HttpStatusCode.Unauthorized,
      body: presentError('UNAUTHORIZED', error.message),
    } as const
  }
  return {
    status: HttpStatusCode.BadRequest,
    body: presentError('INVALID_INPUT', error.message),
  } as const
}
