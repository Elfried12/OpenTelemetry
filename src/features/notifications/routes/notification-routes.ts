import { Hono } from 'hono'
import * as v from 'valibot'
import {
  documentRoute,
  jsonBody,
  jsonResponse,
  parameter,
} from '#/infrastructure/http/openapi.ts'
import { notificationDtoSchema, notificationExample } from './documentation.ts'
import type { MiddlewareHandler } from 'hono'
import type { NotificationCommandController } from '#/features/notifications/controllers/commands/notification-controller.ts'
import type { NotificationQueryController } from '#/features/notifications/controllers/queries/notification-controller.ts'
import type { NotificationEnv } from '#/features/notifications/controllers/recipient.ts'
import { httpFailure } from '#/features/notifications/controllers/http-result.ts'
import {
  notificationIdSchema,
  preferencesSchema,
} from '#/features/notifications/validation.ts'
import { requestJson } from '#/infrastructure/http/request.ts'
import { parse } from '#/shared-kernel/validation.ts'
import { Result } from '#/shared-kernel/result.ts'

export function notificationRoutes(
  app: Hono,
  commands: NotificationCommandController,
  queries: NotificationQueryController,
  identify: MiddlewareHandler<NotificationEnv>,
) {
  const routes = new Hono<NotificationEnv>()
  routes.use('/me/notifications', identify)
  routes.use('/me/notifications/*', identify)
  routes.use('/me/notification-preferences', identify)
  routes.get(
    '/me/notifications',
    documentRoute('Notifications', {
      operationId: 'listMyNotifications',
      summary: 'List my notifications',
      description:
        'Returns the enrolled recipient inbox oldest first, including read notifications. Returns an empty array when there are none. There is no pagination.',
      authenticated: true,
      responses: {
        200: jsonResponse(
          v.array(notificationDtoSchema),
          [notificationExample],
          'Your inbox',
        ),
      },
    }),
    (c) => queries.inbox(c),
  )
  routes.get(
    '/me/notification-preferences',
    documentRoute('Notifications', {
      operationId: 'getMyNotificationPreferences',
      summary: 'Get my notification preferences',
      authenticated: true,
      responses: {
        200: jsonResponse(
          preferencesSchema,
          { inboxEnabled: true },
          'Current preferences',
        ),
      },
    }),
    (c) => queries.preferences(c),
  )
  routes.patch(
    '/me/notification-preferences',
    documentRoute('Notifications', {
      operationId: 'updateMyNotificationPreferences',
      summary: 'Update my notification preferences',
      description:
        'Disabling the inbox prevents new notifications from being composed. Existing notifications remain. Unknown fields are rejected.',
      authenticated: true,
      requestBody: jsonBody(preferencesSchema, { inboxEnabled: false }),
      responses: {
        200: jsonResponse(
          preferencesSchema,
          { inboxEnabled: false },
          'Updated preferences',
        ),
      },
    }),
    async (c) => {
      const input = await requestJson(c.req.raw, preferencesSchema)
      if (Result.isFailure(input)) {
        return httpFailure(c, input.error)
      }
      return commands.preferences(c, input.value.inboxEnabled)
    },
  )
  routes.post(
    '/me/notifications/:notificationId/read',
    documentRoute('Notifications', {
      operationId: 'markMyNotificationRead',
      summary: 'Mark a notification as read',
      description:
        'Only notifications in your inbox can be marked read. Repeating the request preserves the first read timestamp. No request body is needed.',
      authenticated: true,
      parameters: [
        parameter(
          'path',
          'notificationId',
          notificationIdSchema,
          notificationExample.id,
          'Notification UUID v7',
        ),
      ],
      errors: [404],
      responses: {
        200: jsonResponse(
          notificationDtoSchema,
          { ...notificationExample, readAt: '2030-06-02T10:00:00.000Z' },
          'Read notification',
        ),
      },
    }),
    async (c) => {
      const id = parse(notificationIdSchema, c.req.param('notificationId'))
      if (Result.isFailure(id)) {
        return httpFailure(c, id.error)
      }
      return commands.markRead(c, id.value)
    },
  )
  app.route('/', routes)
  return app
}
