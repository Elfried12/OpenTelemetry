import * as v from 'valibot'
import {
  eventResourceSchema,
  reservationResourceSchema,
} from '#/features/events/presentation/resources.ts'
import { createEventSchema } from '#/features/events/validation.ts'

export const eventExample = {
  id: '01900000-0000-7000-8000-000000000201',
  title: 'TypeScript workshop',
  category: 'workshop',
  startsAt: '2030-06-15T09:00:00.000Z',
  capacity: 30,
  venueId: '01900000-0000-7000-8000-000000000003',
  _links: {
    self: {
      href: '/events/01900000-0000-7000-8000-000000000201',
      method: 'GET',
    },
    collection: { href: '/events', method: 'GET' },
    update: {
      href: '/events/01900000-0000-7000-8000-000000000201',
      method: 'PATCH',
    },
  },
} satisfies v.InferOutput<typeof eventResourceSchema>

export const authenticatedEventExample = {
  ...eventExample,
  _links: {
    ...eventExample._links,
    reserve: {
      href: `${eventExample._links.self.href}/reservations`,
      method: 'POST',
    },
    reservations: { href: '/me/reservations', method: 'GET' },
  },
} satisfies v.InferOutput<typeof eventResourceSchema>

export const createEventExample = {
  title: eventExample.title,
  category: eventExample.category,
  startsAt: eventExample.startsAt,
  capacity: eventExample.capacity,
  venueId: eventExample.venueId,
} satisfies v.InferInput<typeof createEventSchema>

export const reservationExample = {
  id: '01900000-0000-7000-8000-000000000301',
  eventId: eventExample.id,
  userId: '01900000-0000-7000-8000-000000000001',
  quantity: 2,
  createdAt: '2030-06-01T10:00:00.000Z',
  cancelledAt: null,
  _links: {
    collection: { href: '/me/reservations', method: 'GET' },
    event: eventExample._links.self,
    cancel: {
      href: '/reservations/01900000-0000-7000-8000-000000000301/cancellation',
      method: 'POST',
    },
  },
} satisfies v.InferOutput<typeof reservationResourceSchema>

export const cancelledReservationExample = {
  ...reservationExample,
  cancelledAt: '2030-06-02T10:00:00.000Z',
  _links: {
    collection: reservationExample._links.collection,
    event: reservationExample._links.event,
  },
} satisfies v.InferOutput<typeof reservationResourceSchema>
