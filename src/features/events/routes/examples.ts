import * as v from 'valibot'
import {
  eventDtoSchema,
  reservationDtoSchema,
} from '#/features/events/presentation/dtos.ts'
import { createEventSchema } from '#/features/events/validation.ts'

export const eventExample = {
  id: '01900000-0000-7000-8000-000000000201',
  title: 'TypeScript workshop',
  category: 'workshop',
  startsAt: '2030-06-15T09:00:00.000Z',
  capacity: 30,
  venueId: '01900000-0000-7000-8000-000000000003',
} satisfies v.InferOutput<typeof eventDtoSchema>

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
} satisfies v.InferOutput<typeof reservationDtoSchema>
