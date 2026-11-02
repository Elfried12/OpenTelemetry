import type { Context } from 'hono'
import type { NotificationService } from '#/features/notifications/application/notification-service.ts'
import type { NotificationEnv } from '#/features/notifications/controllers/recipient.ts'
import { HttpStatusCode } from '#/infrastructure/http/http-code.ts'

export function createNotificationQueryController(
  service: NotificationService,
) {
  return {
    inbox: async (context: Context<NotificationEnv>) =>
      context.json(
        await service.inbox(context.get('recipient').id),
        HttpStatusCode.Ok,
      ),
    preferences: (context: Context<NotificationEnv>) =>
      context.json(
        { inboxEnabled: context.get('recipient').inboxEnabled },
        HttpStatusCode.Ok,
      ),
  }
}

export type NotificationQueryController = ReturnType<
  typeof createNotificationQueryController
>
