import type { Hono } from 'hono'
import * as v from 'valibot'
import {
  documentRoute,
  jsonResponseExamples,
} from '#/infrastructure/http/openapi.ts'
import { reservationResourceSchema } from '#/features/events/presentation/resources.ts'
import { reservationExample, cancelledReservationExample } from './examples.ts'
import type { UserQueryController } from '#/features/events/controllers/queries/user-controller.ts'

export function userRoutes(routes: Hono, controller: UserQueryController) {
  routes.get(
    '/me/reservations',
    documentRoute('Reservations', {
      operationId: 'listMyReservations',
      summary: 'List my reservations',
      description:
        'Returns active and cancelled reservations for the demo user, with event and collection links. Only active reservations include a cancel action. Returns an empty array when there are none.',
      identity: 'required',
      responses: {
        200: jsonResponseExamples(
          v.array(reservationResourceSchema),
          {
            active: {
              summary: 'Active reservation with a cancel action',
              value: [reservationExample],
            },
            cancelled: {
              summary: 'Cancelled reservation without a cancel action',
              value: [cancelledReservationExample],
            },
          },
          'Your reservations',
        ),
      },
    }),
    (c) => controller.reservations(c),
  )
  return routes
}
