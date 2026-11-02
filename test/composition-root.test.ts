import { expect, test } from 'bun:test'
import { anApplication } from './support/application-fixture.ts'
import { TOKEN } from '#/infrastructure/di/tokens.ts'
import { createContainer } from '#/composition-root.ts'
import type { DomainEvent } from '#/features/events/contracts/events.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'

test('one app per container and independent apps do not share repositories or buses', async () => {
  const first = anApplication()
  const second = anApplication()
  const firstApp = first.container.resolve(TOKEN.App)
  const secondApp = second.container.resolve(TOKEN.App)
  expect(firstApp).toBe(first.container.resolve(TOKEN.App))
  expect(firstApp).not.toBe(secondApp)
  expect(first.container.resolve(TOKEN.EventBus)).not.toBe(
    second.container.resolve(TOKEN.EventBus),
  )
  await first.createEvent()
  const response = await firstApp.request('/events')
  expect(response.status).toBe(200)
  expect(await response.json()).toHaveLength(1)
  expect(await (await secondApp.request('/events')).json()).toEqual([])
  expect((await firstApp.request('/missing')).status).toBe(404)
})

test('the mock logger receives the event name and payload through the shared bus', async () => {
  const fixture = anApplication()
  const logs: { message: string; event: EventEnvelope<DomainEvent> }[] = []
  const container = createContainer({
    repository: fixture.repository,
    clock: { now: () => new Date('2030-01-01T00:00:00Z') },
    notificationLogger: {
      log: (message, event) => {
        logs.push({ message, event })
      },
    },
  })
  await container.resolve(TOKEN.CreateEventUseCase).execute(fixture.eventInput)
  expect(logs).toEqual([
    {
      message: '[notification] EventCreated',
      event: {
        messageId: expect.any(String),
        occurredAt: new Date('2030-01-01T00:00:00Z'),
        version: 1,
        event: {
          _tag: 'EventCreated',
          content: { ...fixture.eventInput, eventId: expect.any(String) },
        },
      },
    },
  ])
})

test('resolving services repeatedly does not duplicate notifications and subscriptions can be stopped', async () => {
  const app = anApplication()
  app.container.resolve(TOKEN.App)
  app.container.resolve(TOKEN.App)
  app.container.resolve(TOKEN.CreateEventUseCase)
  await app.createEvent()
  expect(app.notifications).toHaveLength(1)
  const unsubscribe = app.container.resolve(TOKEN.NotificationSubscription)
  unsubscribe()
  unsubscribe()
  await app.createEvent()
  expect(app.notifications).toHaveLength(1)
})
