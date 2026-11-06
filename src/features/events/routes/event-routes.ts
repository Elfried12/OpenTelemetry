import type { Hono } from 'hono'
import * as v from 'valibot'
import {
  documentRoute,
  jsonBody,
  jsonResponse,
  jsonResponseExamples,
  parameter,
} from '#/platform/http/openapi.ts'
import {
  eventResourceSchema,
  reservationResourceSchema,
} from '#/features/events/presentation/resources.ts'
import {
  createEventExample,
  eventExample,
  authenticatedEventExample,
  cancelledReservationExample,
  reservationExample,
} from './examples.ts'
import type { EventCommandController } from '#/features/events/controllers/commands/event-controller.ts'
import type { EventQueryController } from '#/features/events/controllers/queries/event-controller.ts'
import { httpFailure } from '#/features/events/controllers/http-result.ts'
import { requestJson } from '#/platform/http/request.ts'
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
  const eventId = parameter(
    'path',
    'eventId',
    eventIdSchema,
    eventExample.id,
    'Event UUID v7',
  )
  const reservationId = parameter(
    'path',
    'reservationId',
    reservationIdSchema,
    reservationExample.id,
    'Reservation UUID v7',
  )

  routes.get(
    '/events',
    documentRoute('Events', {
      operationId: 'listEvents',
      summary: 'List events',
      description:
        'Optional filters can be combined. Returns an empty array when no events match. There is no pagination. Each event includes _links. A valid bearer session adds reserve for future events and reservations for the current user. An invalid supplied identity is rejected, not treated as anonymous.',
      identity: 'optional',
      parameters: [
        parameter(
          'query',
          'category',
          eventFilterSchema.entries.category,
          'workshop',
          'Exact category match',
        ),
        parameter(
          'query',
          'after',
          eventFilterSchema.entries.after,
          '2030-01-01T00:00:00.000Z',
          'Only events starting strictly after this date-time',
        ),
      ],
      errors: [400],
      responses: {
        200: jsonResponseExamples(
          v.array(eventResourceSchema),
          {
            anonymous: { summary: 'Anonymous visitor', value: [eventExample] },
            authenticated: {
              summary: 'Known demo user',
              value: [authenticatedEventExample],
            },
          },
          'Matching events. Action links depend on identity and event start time.',
        ),
      },
    }),
    async (c) => {
      const input = parse(eventFilterSchema, c.req.query())
      if (Result.isFailure(input)) {
        return httpFailure(c, input.error)
      }
      return queries.list(c, input.value)
    },
  )
  routes.post(
    '/events',
    documentRoute('Events', {
      operationId: 'createEvent',
      summary: 'Create an event',
      identity: 'optional',
      description:
        'Requires an existing venue and a start date in the future. Title and category are trimmed. Capacity is a positive 32-bit integer. Unknown fields are rejected.',
      requestBody: jsonBody(createEventSchema, createEventExample),
      errors: [400],
      responses: {
        201: {
          ...jsonResponse(
            eventResourceSchema,
            eventExample,
            'Event created with links. A valid bearer session also adds reserve and reservations.',
          ),
          headers: {
            Location: {
              description: 'Relative URL of the created event',
              schema: { type: 'string' },
              example: `/events/${eventExample.id}`,
            },
          },
        },
      },
    }),
    async (c) => {
      const input = await requestJson(c.req.raw, createEventSchema)
      if (Result.isFailure(input)) {
        return httpFailure(c, input.error)
      }
      return commands.create(c, input.value)
    },
  )
  routes.get(
    '/events/:eventId',
    documentRoute('Events', {
      operationId: 'getEvent',
      summary: 'Get an event',
      identity: 'optional',
      description:
        'Anonymous visitors receive self, collection and, before the event starts, update links. A valid bearer session also adds reserve before the start and reservations. Invalid supplied identities return 400 or 401. Links do not guarantee available seats; the reservation command rechecks capacity.',
      parameters: [eventId],
      errors: [400, 404],
      responses: {
        200: jsonResponseExamples(
          eventResourceSchema,
          {
            anonymous: { summary: 'Anonymous visitor', value: eventExample },
            authenticated: {
              summary: 'Known demo user',
              value: authenticatedEventExample,
            },
            started: {
              summary: 'Event has started, anonymous visitor',
              value: {
                ...eventExample,
                _links: {
                  self: eventExample._links.self,
                  collection: eventExample._links.collection,
                },
              },
            },
          },
          'Event details with available navigation and actions',
        ),
      },
    }),
    async (c) => {
      const id = parse(eventIdSchema, c.req.param('eventId'))
      if (Result.isFailure(id)) {
        return httpFailure(c, id.error)
      }
      return queries.get(c, id.value)
    },
  )
  routes.patch(
    '/events/:eventId',
    documentRoute('Events', {
      operationId: 'updateEvent',
      summary: 'Update an event',
      identity: 'optional',
      description:
        'Provide at least one field. Unknown fields are rejected. Capacity cannot be reduced below the seats already reserved.',
      parameters: [eventId],
      requestBody: jsonBody(updateEventSchema, { capacity: 50 }),
      errors: [400, 404, 409],
      responses: {
        200: jsonResponse(
          eventResourceSchema,
          { ...eventExample, capacity: 50 },
          'Updated event',
        ),
      },
    }),
    async (c) => {
      const id = parse(eventIdSchema, c.req.param('eventId'))
      if (Result.isFailure(id)) {
        return httpFailure(c, id.error)
      }
      const patch = await requestJson(c.req.raw, updateEventSchema)
      if (Result.isFailure(patch)) {
        return httpFailure(c, patch.error)
      }
      return commands.update(c, id.value, patch.value)
    },
  )
  routes.post(
    '/events/:eventId/reservations',
    documentRoute('Reservations', {
      operationId: 'reserveEvent',
      summary: 'Reserve seats for an event',
      description:
        'Reserves a positive number of seats for the demo user. Returns a conflict when insufficient seats remain.',
      identity: 'required',
      parameters: [eventId],
      requestBody: jsonBody(reservationSchema, { quantity: 2 }),
      errors: [404, 409],
      responses: {
        201: jsonResponse(
          reservationResourceSchema,
          reservationExample,
          'Reservation created',
        ),
      },
    }),
    async (c) => {
      const body = await requestJson(c.req.raw, reservationSchema)
      if (Result.isFailure(body)) {
        return httpFailure(c, body.error)
      }
      const id = parse(eventIdSchema, c.req.param('eventId'))
      if (Result.isFailure(id)) {
        return httpFailure(c, id.error)
      }
      return commands.reserve(c, id.value, body.value.quantity)
    },
  )
  routes.post(
    '/reservations/:reservationId/cancellation',
    documentRoute('Reservations', {
      operationId: 'cancelReservation',
      summary: 'Cancel my reservation',
      description:
        'Cancels a reservation owned by the demo user and releases its seats, even after the event starts. Repeating a cancellation returns a conflict. No request body is needed.',
      identity: 'required',
      parameters: [reservationId],
      errors: [404, 409],
      responses: {
        200: jsonResponse(
          reservationResourceSchema,
          cancelledReservationExample,
          'Cancelled reservation. The cancel link is no longer present.',
        ),
      },
    }),
    async (c) => {
      const id = parse(reservationIdSchema, c.req.param('reservationId'))
      if (Result.isFailure(id)) {
        return httpFailure(c, id.error)
      }
      return commands.cancel(c, id.value)
    },
  )
  routes.get(
    '/me/reservations',
    documentRoute('Reservations', {
      operationId: 'listMyReservations',
      summary: 'List my reservations',
      description:
        'Returns active and cancelled reservations for the authenticated booking user. Only active reservations include a cancel action.',
      identity: 'required',
      responses: {
        200: jsonResponseExamples(
          v.array(reservationResourceSchema),
          {
            active: {
              summary: 'Active reservation',
              value: [reservationExample],
            },
            cancelled: {
              summary: 'Cancelled reservation',
              value: [cancelledReservationExample],
            },
          },
          'Your reservations',
        ),
      },
    }),
    (c) => queries.reservations(c),
  )
  return routes
}
