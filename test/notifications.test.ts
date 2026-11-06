import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import * as v from 'valibot'
import { sessionSchema } from '#/features/identity/routes/session-routes.ts'
import { InMemoryIdentityRepository } from '#/features/identity/infrastructure/in-memory-identity-repository.ts'
import { SQL } from 'bun'
import { GenericContainer, Wait } from 'testcontainers'
import { v7 } from 'uuid'
import type { NotificationRepository } from '#/features/notifications/application/ports.ts'
import { NotificationService } from '#/features/notifications/application/notification-service.ts'
import { InMemoryNotificationRepository } from '#/features/notifications/infrastructure/in-memory-notification-repository.ts'
import { PostgresNotificationRepository } from '#/features/notifications/infrastructure/postgres-notification-repository.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import { createContainer } from '#/composition-root.ts'
import { TOKEN } from '#/platform/di/tokens.ts'
import { anApplication } from './support/application-fixture.ts'

const alice = {
  id: '01900000-0000-7000-8000-000000000101',
  bookingUserRef: '01900000-0000-7000-8000-000000000001',
  inboxEnabled: true,
}
const bob = {
  id: '01900000-0000-7000-8000-000000000102',
  bookingUserRef: '01900000-0000-7000-8000-000000000002',
  inboxEnabled: true,
}
const at = new Date('2030-01-01T00:00:00Z')

for (const backend of ['memory', 'postgres'] as const) {
  describe(`Notifications repository: ${backend}`, () => {
    let repository: NotificationRepository
    let database: SQL
    let close = async () => {}
    beforeAll(async () => {
      if (backend === 'memory') {
        repository = new InMemoryNotificationRepository([alice, bob])
        return
      }
      const container = await new GenericContainer('postgres:17-alpine')
        .withEnvironment({
          POSTGRES_DB: 'events',
          POSTGRES_USER: 'events',
          POSTGRES_PASSWORD: 'events',
        })
        .withExposedPorts(5432)
        .withWaitStrategy(
          Wait.forLogMessage(
            'database system is ready to accept connections',
            2,
          ),
        )
        .start()
      const sql = new SQL(
        `postgres://events:events@${container.getHost()}:${container.getMappedPort(5432)}/events`,
        { max: 1 },
      )
      database = sql
      close = async () => {
        await sql.close()
        await container.stop()
      }
      await sql.unsafe(
        await Bun.file(new URL('../sql/init.sql', import.meta.url)).text(),
      )
      repository = new PostgresNotificationRepository(sql)
    }, 60_000)
    afterAll(async () => {
      await close()
    })

    if (backend === 'postgres') {
      test('legacy public tables move without losing rows or foreign keys, and migration can be rerun', async () => {
        const reservationId = v7()
        await database`INSERT INTO events.reservations (id, event_id, user_id, quantity)
          VALUES (${reservationId}, '01900000-0000-7000-8000-000000000004', ${alice.bookingUserRef}, 1)`
        await database.unsafe(`ALTER TABLE events.users SET SCHEMA public;
          ALTER TABLE events.venues SET SCHEMA public;
          ALTER TABLE events.events SET SCHEMA public;
          ALTER TABLE events.reservations SET SCHEMA public;`)
        const migration = await Bun.file(
          new URL('../sql/migrate-bounded-contexts.sql', import.meta.url),
        ).text()
        await database.unsafe(migration)
        await database.unsafe(migration)
        await database.unsafe(
          await Bun.file(new URL('../sql/init.sql', import.meta.url)).text(),
        )
        const rows = await database`SELECT r.id FROM events.reservations r
          JOIN events.users u ON r.user_id = u.id JOIN events.events e ON r.event_id = e.id
          WHERE r.id = ${reservationId}`
        expect(rows).toHaveLength(1)
        const [old] =
          await database`SELECT to_regclass('public.users') AS users`
        expect(old.users).toBeNull()
      })
    }

    test('recipients have their own identity and no Events user fields', async () => {
      expect(
        Option.getOrNull(await repository.findRecipient(alice.bookingUserRef)),
      ).toEqual(alice)
      expect(alice.id).not.toBe(alice.bookingUserRef)
      expect(await repository.findRecipient(v7())).toEqual(Option.none())
    })

    test('concurrent replay creates one inbox item, owner-scoped reads are idempotent', async () => {
      const service = new NotificationService(repository, v7, () => at)
      const notice = {
        sourceMessageId: v7(),
        bookingUserRef: alice.bookingUserRef,
        bookingRef: v7(),
        kind: 'confirmed' as const,
        seats: 2,
        occurredAt: at,
      }
      await Promise.all([service.receive(notice), service.receive(notice)])
      const inbox = await service.inbox(alice.id)
      expect(inbox).toHaveLength(1)
      const notification = inbox[0]!
      expect(notification).toMatchObject({
        recipientId: alice.id,
        subject: 'Booking confirmed',
        readAt: null,
        bookingRef: notice.bookingRef,
      })
      expect(await service.markRead(bob.id, notification.id)).toEqual(
        Option.none(),
      )
      expect(
        Option.getOrNull(await service.markRead(alice.id, notification.id))
          ?.readAt,
      ).toEqual(at)
      expect(
        Option.getOrNull(
          await repository.markRead(
            alice.id,
            notification.id,
            new Date('2031-01-01'),
          ),
        )?.readAt,
      ).toEqual(at)
    })

    test('preferences suppress messages permanently even if replayed after opting back in', async () => {
      const service = new NotificationService(repository, v7, () => at)
      const notice = {
        sourceMessageId: v7(),
        bookingUserRef: bob.bookingUserRef,
        bookingRef: v7(),
        kind: 'cancelled' as const,
        seats: 1,
        occurredAt: at,
      }
      await service.preferences(bob.id, false)
      await service.receive(notice)
      await service.preferences(bob.id, true)
      await service.receive(notice)
      expect(await service.inbox(bob.id)).toEqual([])
      await service.receive({ ...notice, sourceMessageId: v7() })
      expect(await service.inbox(bob.id)).toHaveLength(1)
    })
  })
}

test('booking and cancellation reach the independent notification inbox through the bus and HTTP', async () => {
  const fixture = anApplication()
  const recipients = [
    { ...alice, bookingUserRef: fixture.alice },
    { ...bob, bookingUserRef: fixture.bob },
  ]
  const container = createContainer({
    applicationSecretKey: 'test-application-secret-key-not-for-production',
    repository: fixture.repository,
    identityRepository: new InMemoryIdentityRepository(
      new Set([fixture.alice, fixture.bob]),
    ),
    notificationRepository: new InMemoryNotificationRepository(recipients),
    clock: { now: () => at },
    notificationLogger: { log() {} },
  })
  const app = container.resolve(TOKEN.App)
  const event = Result.getOrThrow(
    await container
      .resolve(TOKEN.CreateEventUseCase)
      .execute(fixture.eventInput),
  )
  const reservation = Result.getOrThrow(
    await container
      .resolve(TOKEN.ReserveEventUseCase)
      .execute({ eventId: event.data.id, userId: fixture.alice, quantity: 1 }),
  )
  await container
    .resolve(TOKEN.CancelReservationUseCase)
    .execute({ id: reservation.data.id, userId: fixture.alice })
  const session = v.parse(
    sessionSchema,
    await container.resolve(TOKEN.SessionService).create(fixture.alice),
  )
  const headers = { Authorization: `Bearer ${session.token}` }
  const bobsSession = v.parse(
    sessionSchema,
    await container.resolve(TOKEN.SessionService).create(fixture.bob),
  )
  const response = await app.request('/me/notifications', { headers })
  expect(response.status).toBe(200)
  const inbox = (await response.json()) as { id: string; subject: string }[]
  expect(inbox.map((n) => n.subject)).toEqual([
    'Booking confirmed',
    'Booking cancelled',
  ])
  expect((await app.request('/me/notifications')).status).toBe(401)
  expect(
    (
      await app.request('/me/notifications', {
        headers: { Authorization: 'Bearer bad' },
      })
    ).status,
  ).toBe(401)
  expect(
    (
      await app.request(`/me/notifications/${inbox[0]!.id}/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bobsSession.token}` },
      })
    ).status,
  ).toBe(404)
  expect(
    (
      await app.request(`/me/notifications/${inbox[0]!.id}/read`, {
        method: 'POST',
        headers,
      })
    ).status,
  ).toBe(200)
  const changed = await app.request('/me/notification-preferences', {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inboxEnabled: false }),
  })
  expect(await changed.json()).toEqual({ inboxEnabled: false })
  expect(
    await (
      await app.request('/me/notification-preferences', { headers })
    ).json(),
  ).toEqual({ inboxEnabled: false })
  expect(
    (
      await app.request('/me/notification-preferences', {
        method: 'PATCH',
        headers,
        body: '{',
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await app.request('/me/notification-preferences', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ inboxEnabled: 'no' }),
      })
    ).status,
  ).toBe(400)
  expect((await app.request('/me/reservations', { headers })).status).toBe(200)
})
