import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { NotificationService } from '#/features/notifications/application/notification-service.ts'
import { createNotificationCommandController } from '#/features/notifications/controllers/commands/notification-controller.ts'
import { createNotificationQueryController } from '#/features/notifications/controllers/queries/notification-controller.ts'
import { createRecipientMiddleware } from '#/features/notifications/controllers/recipient.ts'
import { InMemoryNotificationRepository } from '#/features/notifications/infrastructure/in-memory-notification-repository.ts'
import { notificationRoutes } from '#/features/notifications/routes/notification-routes.ts'

const recipient = {
  id: '01900000-0000-7000-8000-000000000101',
  bookingUserRef: '01900000-0000-7000-8000-000000000001',
  inboxEnabled: true,
}
const at = new Date('2030-01-01T00:00:00Z')

function fixture() {
  const repository = new InMemoryNotificationRepository([recipient])
  const service = new NotificationService(
    repository,
    () => '01900000-0000-7000-8000-000000000201',
    () => at,
  )
  const app = notificationRoutes(
    new Hono(),
    createNotificationCommandController(service),
    createNotificationQueryController(service),
    createRecipientMiddleware(service),
  )
  return { app, service }
}

const headers = { 'X-User-Id': recipient.bookingUserRef }

test('notification endpoints identify the recipient before validating commands', async () => {
  const { app } = fixture()
  const paths = [
    { path: '/me/notifications', method: 'GET' },
    { path: '/me/notification-preferences', method: 'GET' },
    { path: '/me/notification-preferences', method: 'PATCH' },
    { path: '/me/notifications/invalid/read', method: 'POST' },
  ]
  for (const { path, method } of paths) {
    const missing = await app.request(path, { method })
    expect(missing.status).toBe(401)
    expect(await missing.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'X-User-Id is required' },
    })
    const malformed = await app.request(path, {
      method,
      headers: { 'X-User-Id': 'bad' },
    })
    expect(malformed.status).toBe(400)
    const unenrolled = await app.request(path, {
      method,
      headers: { 'X-User-Id': '01900000-0000-7000-8000-000000000099' },
    })
    expect(unenrolled.status).toBe(401)
    expect(await unenrolled.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Recipient is not enrolled' },
    })
  }
})

test('notification commands reject malformed JSON, invalid preferences and identifiers', async () => {
  const { app } = fixture()
  for (const body of [
    '{',
    '{}',
    '{"inboxEnabled":"no"}',
    '{"inboxEnabled":true,"extra":1}',
  ]) {
    const response = await app.request('/me/notification-preferences', {
      method: 'PATCH',
      headers,
      body,
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'INVALID_INPUT' },
    })
  }
  const invalid = await app.request('/me/notifications/invalid/read', {
    method: 'POST',
    headers,
  })
  expect(invalid.status).toBe(400)
  expect(await invalid.json()).toEqual({
    error: { code: 'INVALID_INPUT', message: 'Expected a lowercase UUID v7' },
  })
  const absent = await app.request(
    '/me/notifications/01900000-0000-7000-8000-000000000099/read',
    {
      method: 'POST',
      headers,
    },
  )
  expect(absent.status).toBe(404)
  expect(await absent.json()).toEqual({
    error: { code: 'NOT_FOUND', message: 'Notification not found' },
  })
})

test('opting out consumes the message without composing a notification or allocating an ID', async () => {
  const repository = new InMemoryNotificationRepository([
    { ...recipient, inboxEnabled: false },
  ])
  let idsAllocated = 0
  const service = new NotificationService(
    repository,
    () => {
      idsAllocated += 1
      return '01900000-0000-7000-8000-000000000201'
    },
    () => at,
  )
  const notice = {
    sourceMessageId: '01900000-0000-7000-8000-000000000301',
    bookingUserRef: recipient.bookingUserRef,
    bookingRef: '01900000-0000-7000-8000-000000000401',
    kind: 'confirmed' as const,
    seats: 1,
    occurredAt: at,
  }
  await service.receive(notice)
  expect(idsAllocated).toBe(0)
  await service.preferences(recipient.id, true)
  await service.receive(notice)
  expect(await service.inbox(recipient.id)).toEqual([])
})
