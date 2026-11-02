import { Hono } from 'hono'
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
  routes.get('/me/notifications', (c) => queries.inbox(c))
  routes.get('/me/notification-preferences', (c) => queries.preferences(c))
  routes.patch('/me/notification-preferences', async (c) => {
    const input = await requestJson(c.req.raw, preferencesSchema)
    if (Result.isFailure(input)) {
      return httpFailure(c, input.error)
    }
    return commands.preferences(c, input.value.inboxEnabled)
  })
  routes.post('/me/notifications/:notificationId/read', async (c) => {
    const id = parse(notificationIdSchema, c.req.param('notificationId'))
    if (Result.isFailure(id)) {
      return httpFailure(c, id.error)
    }
    return commands.markRead(c, id.value)
  })
  app.route('/', routes)
  return app
}
