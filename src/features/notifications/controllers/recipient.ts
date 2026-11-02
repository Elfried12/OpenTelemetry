import { createMiddleware } from 'hono/factory'
import type { NotificationService } from '#/features/notifications/application/notification-service.ts'
import type { Recipient } from '#/features/notifications/domain/notification.ts'
import { Unauthorized } from '#/features/notifications/domain/errors.ts'
import { httpFailure } from '#/features/notifications/controllers/http-result.ts'
import { bookingUserRefSchema } from '#/features/notifications/validation.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import { parse } from '#/shared-kernel/validation.ts'

export type NotificationEnv = { Variables: { recipient: Recipient } }

export function createRecipientMiddleware(service: NotificationService) {
  return createMiddleware<NotificationEnv>(async (context, next) => {
    const header = context.req.header('X-User-Id')
    if (header === undefined) {
      return httpFailure(context, new Unauthorized('X-User-Id is required'))
    }
    const parsed = parse(bookingUserRefSchema, header)
    if (Result.isFailure(parsed)) {
      return httpFailure(context, parsed.error)
    }
    const recipient = await service.recipient(parsed.value)
    if (Option.isNone(recipient)) {
      return httpFailure(context, new Unauthorized('Recipient is not enrolled'))
    }
    context.set('recipient', recipient.value)
    await next()
  })
}
