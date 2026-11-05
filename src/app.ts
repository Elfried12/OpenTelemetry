import { Hono } from 'hono'
import { documentationRoutes } from '#/infrastructure/http/openapi.ts'
import { HttpStatusCode } from '#/infrastructure/http/http-code.ts'
import { HTTPException } from 'hono/http-exception'
import type { EventCommandController } from '#/features/events/controllers/commands/event-controller.ts'
import type { EventQueryController } from '#/features/events/controllers/queries/event-controller.ts'
import type { UserQueryController } from '#/features/events/controllers/queries/user-controller.ts'
import { userRoutes } from '#/features/events/routes/user-routes.ts'
import { eventRoutes } from '#/features/events/routes/event-routes.ts'
import { presentError } from '#/features/events/presentation/event-presenter.ts'

export function createApp(
  commands: EventCommandController,
  queries: EventQueryController,
  users: UserQueryController,
) {
  const app = new Hono()
  eventRoutes(app, commands, queries)
  userRoutes(app, users)
  documentationRoutes(app)
  app.notFound((c) =>
    c.json(
      presentError('NOT_FOUND', 'Route not found'),
      HttpStatusCode.NotFound,
    ),
  )
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return error.getResponse()
    }
    console.error(error)
    return c.json(
      presentError('INTERNAL_ERROR', 'An unexpected error occurred'),
      HttpStatusCode.InternalServerError,
    )
  })
  return app
}
