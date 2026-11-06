import type {
  ApplicationError,
  EventFilter,
  EventRepository,
  EventsUnitOfWork,
  OutboxWriter,
  OutboxStore,
} from '#/features/events/application/ports.ts'
import type { Event } from '#/features/events/domain/event.ts'
import type { Reservation } from '#/features/events/domain/reservation.ts'
import type {
  EventId,
  ReservationId,
  UserId,
  VenueId,
} from '#/features/events/domain/ids.ts'
import { InvalidInput, NotFound } from '#/features/events/domain/errors.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import type { DomainEvent } from '#/features/events/contracts/events.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'
import { matchesEventFilter } from '#/features/events/infrastructure/repository/event-predicates.ts'

export class InMemoryEventRepository
  implements EventRepository, EventsUnitOfWork, OutboxStore
{
  private events = new Map<EventId, Event>()
  private reservations = new Map<ReservationId, Reservation>()
  private pending: EventEnvelope<DomainEvent>[] = []
  private tail: Promise<unknown> = Promise.resolve()

  private exclusive<Value>(work: () => Promise<Value>): Promise<Value> {
    const task = this.tail.then(work)
    this.tail = task.catch(() => {})
    return task
  }

  run<Value>(
    work: (scope: {
      events: EventRepository
      outbox: OutboxWriter
    }) => Promise<Result<Value, ApplicationError>>,
  ): Promise<Result<Value, ApplicationError>> {
    return this.exclusive(async () => {
      const events = new Map(this.events)
      const reservations = new Map(this.reservations)
      const pending = [...this.pending]
      let committed = false
      try {
        const result = await work({
          events: this,
          outbox: {
            append: async (envelope) => {
              if (
                this.pending.some(
                  (message) => message.messageId === envelope.messageId,
                )
              ) {
                throw new Error('Duplicate message ID')
              }
              this.pending.push(envelope)
            },
          },
        })
        committed = Result.isSuccess(result)
        return result
      } finally {
        if (!committed) {
          this.events = events
          this.reservations = reservations
          this.pending = pending
        }
      }
    })
  }

  deliverNext(
    deliver: (envelope: EventEnvelope<DomainEvent>) => Promise<void>,
  ): Promise<boolean> {
    return this.exclusive(async () => {
      const message = this.pending[0]
      if (!message) {
        return false
      }
      await deliver(message)
      this.pending.shift()
      return true
    })
  }

  constructor(
    private readonly references: {
      users: ReadonlySet<UserId>
      venues: ReadonlySet<VenueId>
    },
  ) {}

  async listEvents(filter: EventFilter) {
    return [...this.events.values()]
      .filter(matchesEventFilter(filter))
      .sort(
        (a, b) =>
          a.data.startsAt.getTime() - b.data.startsAt.getTime() ||
          a.data.id.localeCompare(b.data.id),
      )
  }

  async findEvent(id: EventId): Promise<Option<Event>> {
    return Option.fromNullable(this.events.get(id))
  }

  async createEvent(event: Event): Promise<Result<Event, ApplicationError>> {
    if (!this.references.venues.has(event.data.venueId)) {
      return Result.fail(
        new InvalidInput('Referenced venue or user does not exist'),
      )
    }
    if (this.events.has(event.data.id)) {
      throw new Error('Duplicate event ID')
    }
    this.events.set(event.data.id, event)
    return Result.succeed(event)
  }

  async updateEvent(
    id: EventId,
    change: (
      event: Event,
      reservedSeats: number,
    ) => Result<Event, ApplicationError>,
  ): Promise<Result<Event, ApplicationError>> {
    const found = Option.fromNullable(this.events.get(id))
    if (Option.isNone(found)) {
      return Result.fail(new NotFound('Event not found'))
    }
    const changed = change(found.value, this.reservedSeats(id))
    if (Result.isFailure(changed)) {
      return changed
    }
    if (!this.references.venues.has(changed.value.data.venueId)) {
      return Result.fail(
        new InvalidInput('Referenced venue or user does not exist'),
      )
    }
    this.events.set(id, changed.value)
    return changed
  }

  // No await between reading capacity and writing: each mutation is atomic within
  // one JS event-loop turn. This fake does not simulate PostgreSQL row locks.
  async reserve(
    eventId: EventId,
    create: (
      event: Event,
      reservedSeats: number,
    ) => Result<Reservation, ApplicationError>,
  ): Promise<Result<Reservation, ApplicationError>> {
    const found = Option.fromNullable(this.events.get(eventId))
    if (Option.isNone(found)) {
      return Result.fail(new NotFound('Event not found'))
    }
    const result = create(found.value, this.reservedSeats(eventId))
    if (Result.isFailure(result)) {
      return result
    }
    if (!this.references.users.has(result.value.data.userId)) {
      return Result.fail(
        new InvalidInput('Referenced venue or user does not exist'),
      )
    }
    if (this.reservations.has(result.value.data.id)) {
      throw new Error('Duplicate reservation ID')
    }
    this.reservations.set(result.value.data.id, result.value)
    return result
  }

  async listReservations(userId: UserId) {
    return [...this.reservations.values()]
      .filter(({ data }) => data.userId === userId)
      .sort(
        (a, b) =>
          a.data.createdAt.getTime() - b.data.createdAt.getTime() ||
          a.data.id.localeCompare(b.data.id),
      )
  }

  async cancelReservation(
    id: ReservationId,
    userId: UserId,
    change: (reservation: Reservation) => Result<Reservation, ApplicationError>,
  ): Promise<Result<Reservation, ApplicationError>> {
    const found = Option.fromNullable(this.reservations.get(id))
    if (Option.isNone(found) || found.value.data.userId !== userId) {
      return Result.fail(new NotFound('Reservation not found'))
    }
    const changed = change(found.value)
    if (Result.isSuccess(changed)) {
      this.reservations.set(id, changed.value)
    }
    return changed
  }

  async userExists(id: UserId) {
    return this.references.users.has(id)
  }

  private reservedSeats(id: EventId) {
    return [...this.reservations.values()]
      .filter(
        ({ data }) => data.eventId === id && Option.isNone(data.cancelledAt),
      )
      .reduce((total, { data }) => total + data.quantity, 0)
  }
}
