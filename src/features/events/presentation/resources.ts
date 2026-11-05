import * as v from 'valibot'
import { linkSchema } from '#/infrastructure/http/hypermedia.ts'
import type { Event } from '#/features/events/domain/event.ts'
import type { Reservation } from '#/features/events/domain/reservation.ts'
import type { UserId } from '#/features/events/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'
import { eventDtoSchema, reservationDtoSchema } from './dtos.ts'
import { presentEvent, presentReservation } from './event-presenter.ts'

export const eventResourceSchema = v.strictObject({
  ...eventDtoSchema.entries,
  _links: v.strictObject({
    self: linkSchema('GET'),
    collection: linkSchema('GET'),
    update: v.optional(linkSchema('PATCH')),
    reserve: v.optional(linkSchema('POST')),
    reservations: v.optional(linkSchema('GET')),
  }),
})

export const reservationResourceSchema = v.strictObject({
  ...reservationDtoSchema.entries,
  _links: v.strictObject({
    collection: linkSchema('GET'),
    event: linkSchema('GET'),
    cancel: v.optional(linkSchema('POST')),
  }),
})

export function presentEventResource(
  event: Event,
  viewer: Option<UserId>,
  now: Date,
): v.InferOutput<typeof eventResourceSchema> {
  const href = `/events/${event.data.id}`
  const upcoming = event.data.startsAt.getTime() > now.getTime()
  const links: v.InferOutput<typeof eventResourceSchema>['_links'] = {
    self: { href, method: 'GET' },
    collection: { href: '/events', method: 'GET' },
  }
  if (upcoming) {
    links.update = { href, method: 'PATCH' }
    if (Option.isSome(viewer)) {
      links.reserve = { href: `${href}/reservations`, method: 'POST' }
    }
  }
  if (Option.isSome(viewer)) {
    links.reservations = { href: '/me/reservations', method: 'GET' }
  }
  return { ...presentEvent(event), _links: links }
}

// Reservation endpoints already require and verify the owner.
export function presentReservationResource(
  reservation: Reservation,
): v.InferOutput<typeof reservationResourceSchema> {
  const links: v.InferOutput<typeof reservationResourceSchema>['_links'] = {
    collection: { href: '/me/reservations', method: 'GET' },
    event: { href: `/events/${reservation.data.eventId}`, method: 'GET' },
  }
  if (Option.isNone(reservation.data.cancelledAt)) {
    links.cancel = {
      href: `/reservations/${reservation.data.id}/cancellation`,
      method: 'POST',
    }
  }
  return { ...presentReservation(reservation), _links: links }
}
