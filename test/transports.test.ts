import { afterAll, beforeAll, expect, test } from 'bun:test'
import * as v from 'valibot'
import { createContainer } from '#/composition-root.ts'
import { TOKEN } from '#/infrastructure/di/tokens.ts'
import { InMemoryEventRepository } from '#/features/events/infrastructure/repository/in-memory-event-repository.ts'
import { UserId, VenueId, EventId } from '#/features/events/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'
import { errorDtoSchema } from '#/features/events/presentation/dtos.ts'
import {
  eventResourceSchema,
  reservationResourceSchema,
} from '#/features/events/presentation/resources.ts'
import { given } from './support/given.ts'

const alice = UserId.makeUnsafe('01900000-0000-7000-8000-000000000001')
const bob = UserId.makeUnsafe('01900000-0000-7000-8000-000000000002')
const venueId = VenueId.makeUnsafe('01900000-0000-7000-8000-000000000003')
const repository = new InMemoryEventRepository({
  users: new Set([alice, bob]),
  venues: new Set([venueId]),
})
let server: ReturnType<typeof Bun.serve>
let url: string

beforeAll(() => {
  const container = createContainer({
    repository,
    clock: { now: () => new Date('2030-01-01T00:00:00Z') },
    notificationLogger: { log: () => {} },
  })
  const app = container.resolve(TOKEN.App)
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch })
  url = server.url.origin
})
afterAll(async () => {
  await server.stop(true)
})

async function http(
  method: string,
  path: string,
  body?: unknown,
  userId?: string,
) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(userId ? { 'X-User-Id': userId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  }
}
async function anEvent(capacity = 1) {
  const response = await http('POST', '/events', {
    title: 'Test event',
    category: 'testing',
    startsAt: '2099-06-15T18:00:00Z',
    capacity,
    venueId,
  })
  expect(response.status).toBe(201)
  return { event: v.parse(eventResourceSchema, response.body) }
}
async function aReservation() {
  const fixture = await anEvent(2)
  const response = await http(
    'POST',
    `/events/${fixture.event.id}/reservations`,
    { quantity: 2 },
    alice,
  )
  expect(response.status).toBe(201)
  return {
    ...fixture,
    reservation: v.parse(reservationResourceSchema, response.body),
  }
}

test('REST creation returns the DTO and Location for the persisted event', () =>
  given(() => ({
    title: 'Created over HTTP',
    category: 'testing',
    startsAt: '2099-06-15T18:00:00.000Z',
    capacity: 2,
    venueId,
  }))
    .when((input) => http('POST', '/events', input))
    .then(async (response, input) => {
      expect(response.status).toBe(201)
      const event = v.parse(eventResourceSchema, response.body)
      expect(event).toEqual({ ...input, id: event.id, _links: event._links })
      expect(response.headers.get('Location')).toBe(`/events/${event.id}`)
      const persisted = await http('GET', `/events/${event.id}`)
      expect(persisted.status).toBe(200)
      expect(persisted.body).toEqual(event)
    }))

test('concurrent REST reservations cannot claim the same last seat', () =>
  given(anEvent)
    .when(({ event }) =>
      Promise.all(
        [alice, bob].map((user) =>
          http(
            'POST',
            `/events/${event.id}/reservations`,
            { quantity: 1 },
            user,
          ),
        ),
      ),
    )
    .then(async (results, { event }) => {
      expect(results.map((result) => result.status).sort()).toEqual([201, 409])
      const failure = results.find((result) => result.status === 409)
      expect(v.parse(errorDtoSchema, failure?.body).error).toEqual({
        code: 'CONFLICT',
        message: 'Not enough seats',
      })
      const all = [
        ...(await repository.listReservations(alice)),
        ...(await repository.listReservations(bob)),
      ]
      expect(all.filter(({ data }) => data.eventId === event.id)).toHaveLength(
        1,
      )
    }))

test('REST failed writes leave capacity and reservations unchanged', () =>
  given(aReservation)
    .when(async ({ event }) => ({
      overbooked: await http(
        'POST',
        `/events/${event.id}/reservations`,
        { quantity: 1 },
        bob,
      ),
      lowered: await http('PATCH', `/events/${event.id}`, { capacity: 1 }),
      persisted: await http('GET', `/events/${event.id}`),
    }))
    .then(
      async ({ overbooked, lowered, persisted }, { event, reservation }) => {
        expect(overbooked.status).toBe(409)
        expect(lowered.status).toBe(409)
        expect(persisted.body).toEqual(event)
        const bookings = [
          ...(await repository.listReservations(alice)),
          ...(await repository.listReservations(bob)),
        ].filter(({ data }) => data.eventId === event.id)
        expect(bookings.map(({ data }) => String(data.id))).toEqual([
          reservation.id,
        ])
      },
    ))

test('REST cancellation preserves Option state and hides other users bookings', () =>
  given(aReservation)
    .when(async ({ reservation }) => ({
      denied: await http(
        'POST',
        `/reservations/${reservation.id}/cancellation`,
        undefined,
        bob,
      ),
      cancelled: await http(
        'POST',
        `/reservations/${reservation.id}/cancellation`,
        undefined,
        alice,
      ),
      repeated: await http(
        'POST',
        `/reservations/${reservation.id}/cancellation`,
        undefined,
        alice,
      ),
      listed: await http('GET', '/me/reservations', undefined, alice),
    }))
    .then(async ({ denied, cancelled, repeated, listed }, { reservation }) => {
      expect(reservation.cancelledAt).toBeNull()
      expect(denied.status).toBe(404)
      expect(cancelled.status).toBe(200)
      expect(repeated.status).toBe(409)
      const expected = {
        ...reservation,
        cancelledAt: '2030-01-01T00:00:00.000Z',
        _links: {
          collection: reservation._links.collection,
          event: reservation._links.event,
        },
      }
      expect(cancelled.body).toEqual(expected)
      expect(
        v.parse(v.array(reservationResourceSchema), listed.body),
      ).toContainEqual(expected)
      const stored = (await repository.listReservations(alice)).find(
        ({ data }) => data.id === reservation.id,
      )
      expect(stored?.data.cancelledAt).toEqual(
        Option.some(new Date('2030-01-01T00:00:00Z')),
      )
    }))

test.each([
  {
    name: 'invalid ID',
    path: '/events/invalid',
    status: 400,
    code: 'INVALID_INPUT',
  },
  {
    name: 'UUID v4',
    path: `/events/${crypto.randomUUID()}`,
    status: 400,
    code: 'INVALID_INPUT',
  },
  {
    name: 'missing event',
    path: `/events/${EventId.make()}`,
    status: 404,
    code: 'NOT_FOUND',
  },
  {
    name: 'invalid date',
    path: '/events?after=invalid',
    status: 400,
    code: 'INVALID_INPUT',
  },
  {
    name: 'missing identity',
    path: '/me/reservations',
    status: 401,
    code: 'UNAUTHORIZED',
  },
])('REST maps $name to its status and error DTO', (scenario) =>
  given(() => scenario)
    .when(({ path }) => http('GET', path))
    .then((response, expected) => {
      expect(response.status).toBe(expected.status)
      expect(v.parse(errorDtoSchema, response.body).error.code).toBe(
        expected.code,
      )
    }),
)

test('malformed JSON returns a specific validation failure', () =>
  given(() => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  }))
    .when((request) => fetch(`${url}/events`, request))
    .then(async (response) => {
      expect(response.status).toBe(400)
      expect(v.parse(errorDtoSchema, await response.json()).error).toEqual({
        code: 'INVALID_INPUT',
        message: 'Request body must be valid JSON',
      })
    }))
