import { Hono } from 'hono'
import { documentationRoutes } from '#/infrastructure/http/openapi.ts'
import { HttpStatusCode } from '#/infrastructure/http/http-code.ts'
import { HTTPException } from 'hono/http-exception'
import type { EventCommandController } from '#/features/events/controllers/commands/event-controller.ts'
import type { EventQueryController } from '#/features/events/controllers/queries/event-controller.ts'
import type { MiddlewareHandler } from 'hono'
import { eventRoutes } from '#/features/events/routes/event-routes.ts'
import { presentError } from '#/features/events/presentation/event-presenter.ts'

export function createApp(
  commands: EventCommandController,
  queries: EventQueryController,
  authenticate: MiddlewareHandler,
  ...middlewares: MiddlewareHandler[]
) {
  const app = new Hono()
  app.use('*', authenticate)
  for (const middleware of middlewares) {
    app.use('*', middleware)
  }
  eventRoutes(app, commands, queries)
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
