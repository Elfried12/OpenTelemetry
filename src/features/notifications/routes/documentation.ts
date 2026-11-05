import * as v from 'valibot'
import { notificationIdSchema } from '#/features/notifications/validation.ts'
import type { Notification } from '#/features/notifications/domain/notification.ts'

// JSON representation of Notification. Dates are serialized by context.json().
const timestamp = v.pipe(v.string(), v.isoTimestamp())
export const notificationDtoSchema = v.strictObject({
  id: notificationIdSchema,
  recipientId: notificationIdSchema,
  sourceMessageId: notificationIdSchema,
  bookingRef: notificationIdSchema,
  subject: v.string(),
  body: v.string(),
  createdAt: timestamp,
  readAt: v.nullable(timestamp),
} satisfies Record<keyof Notification, v.GenericSchema>)

export const notificationExample = {
  id: '01900000-0000-7000-8000-000000000401',
  recipientId: '01900000-0000-7000-8000-000000000101',
  sourceMessageId: '01900000-0000-7000-8000-000000000501',
  bookingRef: '01900000-0000-7000-8000-000000000301',
  subject: 'Booking confirmed',
  body: '2 seat(s). Booking reference: 01900000-0000-7000-8000-000000000301.',
  createdAt: '2030-06-01T10:00:00.000Z',
  readAt: null,
} satisfies v.InferOutput<typeof notificationDtoSchema>
