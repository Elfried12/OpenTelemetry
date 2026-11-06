import { expect, test } from 'bun:test'
import * as v from 'valibot'
import { TOKEN } from '#/infrastructure/di/tokens.ts'
import { UserId } from '#/features/events/domain/ids.ts'
import {
  eventResourceSchema,
  reservationResourceSchema,
} from '#/features/events/presentation/resources.ts'
import { anExistingEvent } from './support/application-fixture.ts'

async function fixture() {
  const application = await anExistingEvent({ capacity: 2 })
  return { ...application, app: application.container.resolve(TOKEN.App) }
}

test('the same public event has different action links for anonymous and known users', async () => {
  const { app, event, alice, headersFor } = await fixture()
  const path = `/events/${event.data.id}`
  const anonymousResponse = await app.request(path)
  const memberResponse = await app.request(path, {
    headers: await headersFor(alice),
  })
  expect(anonymousResponse.status).toBe(200)
  expect(memberResponse.status).toBe(200)
  const anonymous = v.parse(eventResourceSchema, await anonymousResponse.json())
  const member = v.parse(eventResourceSchema, await memberResponse.json())
  expect(anonymous._links).toEqual({
    self: { href: path, method: 'GET' },
    collection: { href: '/events', method: 'GET' },
    update: { href: path, method: 'PATCH' },
  })
  expect(member).toEqual({
    ...anonymous,
    _links: {
      ...anonymous._links,
      reserve: { href: `${path}/reservations`, method: 'POST' },
      reservations: { href: '/me/reservations', method: 'GET' },
    },
  })
  for (const response of [anonymousResponse, memberResponse]) {
    expect(response.headers.get('Vary')).toContain('Authorization')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  }
  const list = await app.request('/events', {
    headers: await headersFor(alice),
  })
  expect(v.parse(v.array(eventResourceSchema), await list.json())).toEqual([
    member,
  ])
  const anonymousList = await app.request('/events')
  expect(
    v.parse(v.array(eventResourceSchema), await anonymousList.json()),
  ).toEqual([anonymous])
})

test('public event writes return the same identity-aware link format', async () => {
  const { app, alice, eventInput, headersFor } = await fixture()
  const headers = {
    ...(await headersFor(alice)),
    'Content-Type': 'application/json',
  }
  const created = await app.request('/events', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...eventInput,
      startsAt: eventInput.startsAt.toISOString(),
    }),
  })
  expect(created.status).toBe(201)
  const event = v.parse(eventResourceSchema, await created.json())
  expect(event._links.reserve).toBeDefined()
  expect(event._links.reservations).toBeDefined()
  expect(created.headers.get('Location')).toBe(event._links.self.href)
  const update = event._links.update
  if (!update) {
    throw new Error('Expected update action')
  }
  const updated = await app.request(update.href, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ title: 'Updated' }),
  })
  expect(updated.status).toBe(200)
  const result = v.parse(eventResourceSchema, await updated.json())
  expect(result.title).toBe('Updated')
  expect(result._links).toEqual(event._links)
})

test('invalid supplied identities are rejected, including before a public write', async () => {
  const { app, event, eventInput, repository } = await fixture()
  for (const [user, status] of [
    ['invalid', 401],
    [UserId.make(), 401],
  ] as const) {
    const headers = {
      Authorization: `Bearer ${user}`,
      'Content-Type': 'application/json',
    }
    for (const path of ['/events', `/events/${event.data.id}`]) {
      expect((await app.request(path, { headers })).status).toBe(status)
    }
    const update = await app.request(`/events/${event.data.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ title: 'Must not persist' }),
    })
    expect(update.status).toBe(status)
    const create = await app.request('/events', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...eventInput,
        startsAt: eventInput.startsAt.toISOString(),
      }),
    })
    expect(create.status).toBe(status)
  }
  const events = await repository.listEvents({})
  expect(events).toHaveLength(1)
  expect(events[0]?.data.title).toBe(event.data.title)
})

test('update and reserve actions disappear at the exact event start', async () => {
  const { app, alice, event, advanceTo, headersFor } = await fixture()
  const path = `/events/${event.data.id}`
  advanceTo(event.data.startsAt)
  const headers = await headersFor(alice)
  const response = await app.request(path, { headers })
  const resource = v.parse(eventResourceSchema, await response.json())
  expect(resource._links.update).toBeUndefined()
  expect(resource._links.reserve).toBeUndefined()
  expect(resource._links.reservations).toEqual({
    href: '/me/reservations',
    method: 'GET',
  })
  const rejected = await app.request(`${path}/reservations`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: 1 }),
  })
  expect(rejected.status).toBe(409)
})

test('clients can follow reserve, collection, cancellation and event links', async () => {
  const { app, alice, bob, event, headersFor } = await fixture()
  const headers = {
    ...(await headersFor(alice)),
    'Content-Type': 'application/json',
  }
  const resource = v.parse(
    eventResourceSchema,
    await (await app.request(`/events/${event.data.id}`, { headers })).json(),
  )
  const reserve = resource._links.reserve
  if (!reserve) {
    throw new Error('Expected reserve action')
  }
  const booked = await app.request(reserve.href, {
    method: reserve.method,
    headers,
    body: JSON.stringify({ quantity: 2 }),
  })
  expect(booked.status).toBe(201)
  const reservation = v.parse(reservationResourceSchema, await booked.json())
  const cancel = reservation._links.cancel
  if (!cancel) {
    throw new Error('Expected cancel action')
  }
  const collection = reservation._links.collection
  const list = await app.request(collection.href, {
    method: collection.method,
    headers,
  })
  expect(
    v.parse(v.array(reservationResourceSchema), await list.json()),
  ).toEqual([reservation])
  const denied = await app.request(cancel.href, {
    method: cancel.method,
    headers: await headersFor(bob),
  })
  expect(denied.status).toBe(404)
  const cancelled = await app.request(cancel.href, {
    method: cancel.method,
    headers,
  })
  expect(cancelled.status).toBe(200)
  const result = v.parse(reservationResourceSchema, await cancelled.json())
  expect(result.cancelledAt).not.toBeNull()
  expect(result._links.cancel).toBeUndefined()
  const listed = await app.request(collection.href, { headers })
  expect(
    v.parse(v.array(reservationResourceSchema), await listed.json()),
  ).toEqual([result])
  const eventLink = result._links.event
  expect(
    (await app.request(eventLink.href, { method: eventLink.method })).status,
  ).toBe(200)
})

test('advertised actions do not bypass identity or capacity checks', async () => {
  const { app, event, alice, headersFor } = await fixture()
  const path = `/events/${event.data.id}/reservations`
  const body = JSON.stringify({ quantity: 3 })
  const anonymous = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  expect(anonymous.status).toBe(401)
  const overbooked = await app.request(path, {
    method: 'POST',
    headers: {
      ...(await headersFor(alice)),
      'Content-Type': 'application/json',
    },
    body,
  })
  expect(overbooked.status).toBe(409)
})
