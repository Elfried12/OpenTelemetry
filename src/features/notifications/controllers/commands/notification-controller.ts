import type { Context } from 'hono'
import type { NotificationService } from '#/features/notifications/application/notification-service.ts'
import type { NotificationEnv } from '#/features/notifications/controllers/recipient.ts'
import { httpFailure } from '#/features/notifications/controllers/http-result.ts'
import { NotFound } from '#/features/notifications/domain/errors.ts'
import { Option } from '#/shared-kernel/option.ts'
import { HttpStatusCode } from '#/platform/http/http-code.ts'

export function createNotificationCommandController(
  service: NotificationService,
) {
  return {
    preferences: async (
      context: Context<NotificationEnv>,
      inboxEnabled: boolean,
    ) => {
      const updated = await service.preferences(
        context.get('recipient').id,
        inboxEnabled,
      )
      return context.json(
        { inboxEnabled: updated.inboxEnabled },
        HttpStatusCode.Ok,
      )
    },
    markRead: async (
      context: Context<NotificationEnv>,
      notificationId: string,
    ) => {
      const notification = await service.markRead(
        context.get('recipient').id,
        notificationId,
      )
      if (Option.isNone(notification)) {
        return httpFailure(context, new NotFound('Notification not found'))
      }
      return context.json(notification.value, HttpStatusCode.Ok)
    },
  }
}

export type NotificationCommandController = ReturnType<
  typeof createNotificationCommandController
>
