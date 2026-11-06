import type { Event } from '#/features/events/domain/event.ts'
import type { Reservation } from '#/features/events/domain/reservation.ts'
import type {
  EventId,
  ReservationId,
  UserId,
} from '#/features/events/domain/ids.ts'
import type {
  Conflict,
  InvalidInput,
  NotFound,
  Unauthorized,
} from '#/features/events/domain/errors.ts'
import type { DomainEvent } from '#/features/events/contracts/events.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'
import type { Option } from '#/shared-kernel/option.ts'
import type { Result } from '#/shared-kernel/result.ts'

export type ApplicationError = Conflict | InvalidInput | NotFound | Unauthorized
export interface EventFilter {
  category?: string
  after?: Date
}

export interface EventReadRepository {
  listEvents(filter: EventFilter): Promise<Event[]>
  findEvent(id: EventId): Promise<Option<Event>>
}

export interface EventProjectionRepository extends EventReadRepository {
  replaceEvents(events: readonly Event[]): Promise<void>
}

// Expected failures are values; infrastructure faults reject the promise.
// Mutations are serialized by locks or optimistic compare-and-set. A Failure
// causes no write. Callbacks may be retried and must not perform external effects.
export interface EventRepository extends EventReadRepository {
  createEvent(event: Event): Promise<Result<Event, ApplicationError>>
  updateEvent(
    id: EventId,
    change: (
      event: Event,
      reservedSeats: number,
    ) => Result<Event, ApplicationError>,
  ): Promise<Result<Event, ApplicationError>>
  reserve(
    eventId: EventId,
    create: (
      event: Event,
      reservedSeats: number,
    ) => Result<Reservation, ApplicationError>,
  ): Promise<Result<Reservation, ApplicationError>>
  listReservations(userId: UserId): Promise<Reservation[]>
  cancelReservation(
    id: ReservationId,
    userId: UserId,
    change: (reservation: Reservation) => Result<Reservation, ApplicationError>,
  ): Promise<Result<Reservation, ApplicationError>>
  userExists(id: UserId): Promise<boolean>
}

// Success commits; Failure rolls back all earlier writes. Thrown infrastructure
// errors roll back and propagate unchanged. Both dependencies share a transaction.
// Do not publish events or perform external effects inside work.
export interface EventsUnitOfWork {
  run<Value>(
    work: (scope: {
      events: EventRepository
      outbox: OutboxWriter
    }) => Promise<Result<Value, ApplicationError>>,
  ): Promise<Result<Value, ApplicationError>>
}

export interface OutboxWriter {
  append(envelope: EventEnvelope<DomainEvent>): Promise<void>
}

// Atomically claim one pending message and acknowledge only after delivery.
// A delivery rejection leaves the message pending for a later drain.
export interface OutboxStore {
  deliverNext(
    deliver: (envelope: EventEnvelope<DomainEvent>) => Promise<void>,
  ): Promise<boolean>
}

export interface Clock {
  now(): Date
}
export interface IdGenerator {
  next<Id>(): Id
}
