import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { InvalidInput } from '#/features/events/domain/errors.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import { given } from '../support/given.ts'
import {
  anOutboxApplication,
  aSignal,
  startPostgresOutboxDatabase,
} from '../support/postgres-outbox-fixture.ts'

let database: Awaited<ReturnType<typeof startPostgresOutboxDatabase>>
beforeAll(async () => {
  database = await startPostgresOutboxDatabase()
})
beforeEach(async () => {
  await database.reset()
})
afterAll(async () => {
  await database?.close()
})

const anApplication = () => anOutboxApplication(database)
const anApplicationWithPendingMessage = async () => {
  const app = anApplication()
  await app.enqueueMessage()
  return app
}

test('Success commits event and outbox writes together', () =>
  given(anApplication)
    .when(({ unitOfWork, event, message }) =>
      unitOfWork.run(async ({ events, outbox }) => {
        const result = await events.createEvent(event)
        await outbox.append(message)
        return result
      }),
    )
    .then(
      async (result, { peerRepository, event, pendingMessages, messages }) => {
        expect(Result.isSuccess(result)).toBe(true)
        expect(await peerRepository.findEvent(event.data.id)).toEqual(
          Option.some(event),
        )
        expect(await pendingMessages()).toHaveLength(1)
        expect(messages).toEqual([])
      },
    ))

test('neither repository exposes writes before the transaction commits', () =>
  given(anApplication)
    .when(({ unitOfWork, event, message, peerRepository, pendingMessages }) =>
      unitOfWork.run(async ({ events, outbox }) => {
        await events.createEvent(event)
        await outbox.append(message)
        const visibleEvent = await peerRepository.findEvent(event.data.id)
        const visibleMessages = await pendingMessages()
        return Result.succeed({ visibleEvent, visibleMessages })
      }),
    )
    .then((result) => {
      expect(Result.getOrThrow(result)).toEqual({
        visibleEvent: Option.none(),
        visibleMessages: [],
      })
    }))

test('a failed Result rolls back all earlier writes', () =>
  given(() => ({
    ...anApplication(),
    failure: Result.fail(new InvalidInput('later business rule failed')),
  }))
    .when(({ unitOfWork, event, message, failure }) =>
      unitOfWork.run(async ({ events, outbox }) => {
        await events.createEvent(event)
        await outbox.append(message)
        return failure
      }),
    )
    .then(async (result, { failure, storedEvents, storedMessages }) => {
      expect(result).toBe(failure)
      expect(await storedEvents()).toEqual([])
      expect(await storedMessages()).toEqual([])
    }))

test('a thrown infrastructure fault rolls back and propagates unchanged', () =>
  given(() => ({ ...anApplication(), fault: new Error('connection failed') }))
    .when(({ unitOfWork, event, message, fault }) =>
      Result.tryPromise(
        () =>
          unitOfWork.run(async ({ events, outbox }) => {
            await events.createEvent(event)
            await outbox.append(message)
            throw fault
          }),
        (cause) => cause,
      ),
    )
    .then(async (outcome, { fault, storedEvents, storedMessages }) => {
      expect(outcome).toEqual(Result.fail(fault))
      if (Result.isFailure(outcome)) {
        expect(outcome.error).toBe(fault)
      }
      expect(await storedEvents()).toEqual([])
      expect(await storedMessages()).toEqual([])
    }))

test('an outbox insert failure rolls back the preceding event insert', () =>
  given(anApplication)
    .when(({ unitOfWork, event, message }) =>
      Result.tryPromise(
        () =>
          unitOfWork.run(async ({ events, outbox }) => {
            const result = await events.createEvent(event)
            await outbox.append(message)
            await outbox.append(message)
            return result
          }),
        (cause) => cause,
      ),
    )
    .then(async (outcome, { storedEvents, storedMessages }) => {
      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) {
        expect(outcome.error).toBeInstanceOf(SQL.PostgresError)
      }
      expect(await storedEvents()).toEqual([])
      expect(await storedMessages()).toEqual([])
    }))

test('all successful commands enqueue facts, while a business failure enqueues nothing', () =>
  given(anApplication)
    .when(async ({ create, update, reserve, cancel, event, alice }) => {
      const created = Result.getOrThrow(
        await create.execute({
          ...event.data,
          capacity: event.data.capacity.value,
        }),
      )
      const updated = await update.execute({
        id: created.data.id,
        patch: { title: 'Updated' },
      })
      const command = { eventId: created.data.id, userId: alice, quantity: 1 }
      const reservation = Result.getOrThrow(await reserve.execute(command))
      const rejected = await reserve.execute(command)
      const cancelled = await cancel.execute({
        id: reservation.data.id,
        userId: alice,
      })
      return { created, updated, rejected, cancelled }
    })
    .then(
      async (
        { created, updated, rejected, cancelled },
        { dispatcher, messages, clock },
      ) => {
        expect(Result.isSuccess(updated)).toBe(true)
        expect(Result.isFailure(rejected)).toBe(true)
        expect(Result.isSuccess(cancelled)).toBe(true)
        expect(messages).toEqual([])
        expect(await dispatcher.drain()).toBe(4)
        expect(messages.map((message) => message.event._tag)).toEqual([
          'EventCreated',
          'EventUpdated',
          'EventReserved',
          'ReservationCancelled',
        ])
        expect(messages[0]?.occurredAt).toEqual(clock.now())
        expect(messages[0]?.event.content).toMatchObject({
          startsAt: created.data.startsAt,
        })
        expect(await dispatcher.drain()).toBe(0)
      },
    ))

test('an outbox failure rolls back a reservation and leaves its seat available', () =>
  given(async () => {
    const app = anApplication()
    await app.repository.createEvent(app.event)
    return app
  })
    .when(({ reserveWithFailingOutbox, event, alice }) =>
      Result.tryPromise(
        () =>
          reserveWithFailingOutbox.execute({
            eventId: event.data.id,
            userId: alice,
            quantity: 1,
          }),
        (cause) => cause,
      ),
    )
    .then(
      async (
        outcome,
        { storedReservations, storedMessages, reserve, event, alice },
      ) => {
        expect(Result.isFailure(outcome)).toBe(true)
        if (Result.isFailure(outcome)) {
          expect(outcome.error).toBeInstanceOf(SQL.PostgresError)
        }
        expect(await storedReservations()).toEqual([])
        expect(await storedMessages()).toEqual([])
        const nextAttempt = await reserve.execute({
          eventId: event.data.id,
          userId: alice,
          quantity: 1,
        })
        expect(Result.isSuccess(nextAttempt)).toBe(true)
      },
    ))

test('independent transactions cannot both reserve the last seat', () =>
  given(async () => {
    const app = anApplication()
    await app.repository.createEvent(app.event)
    return app
  })
    .when(({ reserve, peerReserve, event, alice }) => {
      const command = { eventId: event.data.id, userId: alice, quantity: 1 }
      return Promise.all([
        reserve.execute(command),
        peerReserve.execute(command),
      ])
    })
    .then(async (results, { storedReservations, pendingMessages }) => {
      expect(results.filter(Result.isSuccess)).toHaveLength(1)
      expect(results.filter(Result.isFailure)).toHaveLength(1)
      expect(await storedReservations()).toHaveLength(1)
      expect(await pendingMessages()).toHaveLength(1)
    }))

test('subscriber failure leaves the message pending for a retry with the same identity', () =>
  given(async () => {
    const app = await anApplicationWithPendingMessage()
    const unsubscribe = app.bus.subscribe('EventReserved', () => {
      throw new Error('subscriber unavailable')
    })
    return { ...app, unsubscribe }
  })
    .when(({ dispatcher }) =>
      Result.tryPromise(
        () => dispatcher.drain(),
        (cause) => cause,
      ),
    )
    .then(
      async (
        outcome,
        { unsubscribe, dispatcher, pendingMessages, messages, message },
      ) => {
        expect(Result.isFailure(outcome)).toBe(true)
        expect(await pendingMessages()).toHaveLength(1)
        unsubscribe()
        expect(await dispatcher.drain()).toBe(1)
        expect(messages.map((received) => received.messageId)).toEqual([
          message.messageId,
          message.messageId,
        ])
        expect(await pendingMessages()).toEqual([])
      },
    ))

test('a concurrent dispatcher skips an already claimed message', () =>
  given(anApplicationWithPendingMessage)
    .when(async ({ store, peerStore }) => {
      const claimed = aSignal()
      const release = aSignal()
      const firstDelivery = store.deliverNext(async () => {
        claimed.resolve()
        await release.promise
      })
      await claimed.promise
      let duplicateDeliveries = 0
      try {
        const secondDelivered = await peerStore.deliverNext(async () => {
          duplicateDeliveries++
        })
        return { secondDelivered, duplicateDeliveries, firstDelivery }
      } finally {
        release.resolve()
      }
    })
    .then(async ({ secondDelivered, duplicateDeliveries, firstDelivery }) => {
      expect(secondDelivered).toBe(false)
      expect(duplicateDeliveries).toBe(0)
      expect(await firstDelivery).toBe(true)
    }))
