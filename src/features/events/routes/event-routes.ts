import type { Hono } from 'hono'
import type { EventCommandController } from '#/features/events/controllers/commands/event-controller.ts'
import type { EventQueryController } from '#/features/events/controllers/queries/event-controller.ts'
import { httpFailure } from '#/features/events/controllers/http-result.ts'
import { requestJson } from '#/infrastructure/http/request.ts'
import { parse } from '#/shared-kernel/validation.ts'
import { Result } from '#/shared-kernel/result.ts'
import {
  createEventSchema,
  eventFilterSchema,
  reservationSchema,
  updateEventSchema,
  eventIdSchema,
  reservationIdSchema,
} from '#/features/events/validation.ts'

export function eventRoutes(
  routes: Hono,
  commands: EventCommandController,
  queries: EventQueryController,
) {
  routes.get('/events', async (c) => {
    const input = parse(eventFilterSchema, c.req.query())
    if (Result.isFailure(input)) {
      return httpFailure(c, input.error)
    }
    return queries.list(c, input.value)
  })
  routes.post('/events', async (c) => {
    const input = await requestJson(c.req.raw, createEventSchema)
    if (Result.isFailure(input)) {
      return httpFailure(c, input.error)
    }
    return commands.create(c, input.value)
  })
  routes.get('/events/:eventId', async (c) => {
    const id = parse(eventIdSchema, c.req.param('eventId'))
    if (Result.isFailure(id)) {
      return httpFailure(c, id.error)
    }
    return queries.get(c, id.value)
  })
  routes.patch('/events/:eventId', async (c) => {
    const id = parse(eventIdSchema, c.req.param('eventId'))
    if (Result.isFailure(id)) {
      return httpFailure(c, id.error)
    }
    const patch = await requestJson(c.req.raw, updateEventSchema)
    if (Result.isFailure(patch)) {
      return httpFailure(c, patch.error)
    }
    return commands.update(c, id.value, patch.value)
  })
  routes.post('/events/:eventId/reservations', async (c) => {
    const body = await requestJson(c.req.raw, reservationSchema)
    if (Result.isFailure(body)) {
      return httpFailure(c, body.error)
    }
    const id = parse(eventIdSchema, c.req.param('eventId'))
    if (Result.isFailure(id)) {
      return httpFailure(c, id.error)
    }
    return commands.reserve(c, id.value, body.value.quantity)
  })
  routes.post('/reservations/:reservationId/cancellation', async (c) => {
    const id = parse(reservationIdSchema, c.req.param('reservationId'))
    if (Result.isFailure(id)) {
      return httpFailure(c, id.error)
    }
    return commands.cancel(c, id.value)
  })
  return routes
}
