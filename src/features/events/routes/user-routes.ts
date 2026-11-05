import type { Hono } from 'hono'
import * as v from 'valibot'
import { documentRoute, jsonResponse } from '#/infrastructure/http/openapi.ts'
import { reservationDtoSchema } from '#/features/events/presentation/dtos.ts'
import { reservationExample } from './examples.ts'
import type { UserQueryController } from '#/features/events/controllers/queries/user-controller.ts'

export function userRoutes(routes: Hono, controller: UserQueryController) {
  routes.get(
    '/me/reservations',
    documentRoute('Reservations', {
      operationId: 'listMyReservations',
      summary: 'List my reservations',
      description:
        'Returns active and cancelled reservations for the demo user. Returns an empty array when there are none.',
      authenticated: true,
      responses: {
        200: jsonResponse(
          v.array(reservationDtoSchema),
          [reservationExample],
          'Your reservations',
        ),
      },
    }),
    (c) => controller.reservations(c),
  )
  return routes
}
