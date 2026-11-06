import { SQL } from 'bun'
import type {
  ApplicationError,
  EventFilter,
  EventRepository,
} from '#/features/events/application/ports.ts'
import type { Event } from '#/features/events/domain/event.ts'
import type { Reservation } from '#/features/events/domain/reservation.ts'
import type {
  EventId,
  ReservationId,
  UserId,
} from '#/features/events/domain/ids.ts'
import { InvalidInput, NotFound } from '#/features/events/domain/errors.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import {
  eventToDomain,
  eventToEntity,
  type EventEntity,
} from '#/features/events/infrastructure/event-entity.ts'
import {
  reservationFromRow,
  reservationToEntity,
} from '#/features/events/infrastructure/reservation-entity.ts'

const eventColumns = 'id, title, category, starts_at, capacity, venue_id'
const reservationColumns =
  'id, event_id, user_id, quantity, created_at, cancelled_at'

export class PostgresEventRepository implements EventRepository {
  constructor(
    private readonly sql: SQL,
    private readonly transactionScoped = false,
  ) {}

  private transaction<Value>(
    work: (tx: SQL) => Promise<Value>,
  ): Promise<Value> {
    // The Unit of Work owns BEGIN/COMMIT. Never open a second transaction.
    return this.transactionScoped ? work(this.sql) : this.sql.begin(work)
  }

  async listEvents(filter: EventFilter) {
    const rows = await this.sql<EventEntity[]>`
      SELECT id, title, category, starts_at, capacity, venue_id FROM events.events
      WHERE (${filter.category ?? null}::text IS NULL OR category = ${filter.category ?? null})
        AND (${filter.after ?? null}::timestamptz IS NULL OR starts_at > ${filter.after ?? null})
      ORDER BY starts_at, id`
    return rows.map(eventToDomain)
  }

  async findEvent(id: EventId): Promise<Option<Event>> {
    const rows = await this.sql.unsafe<EventEntity[]>(
      `SELECT ${eventColumns} FROM events.events WHERE id = $1`,
      [id],
    )
    return Option.map(Option.fromNullable(rows[0]), eventToDomain)
  }

  async createEvent(event: Event): Promise<Result<Event, ApplicationError>> {
    const entity = eventToEntity(event)
    return this.write(async () => {
      await this
        .sql`INSERT INTO events.events (id, title, category, starts_at, capacity, venue_id)
        VALUES (${entity.id}, ${entity.title}, ${entity.category}, ${entity.starts_at}, ${entity.capacity}, ${entity.venue_id})`
      return Result.succeed(event)
    })
  }

  async updateEvent(
    id: EventId,
    change: (
      event: Event,
      reservedSeats: number,
    ) => Result<Event, ApplicationError>,
  ): Promise<Result<Event, ApplicationError>> {
    return this.write(() =>
      this.transaction(async (tx) => {
        const found = await this.lockEvent(tx, id)
        if (Option.isNone(found)) {
          return Result.fail(new NotFound('Event not found'))
        }
        const updated = change(found.value, await this.reservedSeats(tx, id))
        if (Result.isFailure(updated)) {
          return updated
        }
        const entity = eventToEntity(updated.value)
        await tx`UPDATE events.events SET title = ${entity.title}, category = ${entity.category}, starts_at = ${entity.starts_at},
          capacity = ${entity.capacity}, venue_id = ${entity.venue_id} WHERE id = ${id}`
        return updated
      }),
    )
  }

  async reserve(
    eventId: EventId,
    create: (
      event: Event,
      reservedSeats: number,
    ) => Result<Reservation, ApplicationError>,
  ): Promise<Result<Reservation, ApplicationError>> {
    return this.write(() =>
      this.transaction(async (tx) => {
        const found = await this.lockEvent(tx, eventId)
        if (Option.isNone(found)) {
          return Result.fail(new NotFound('Event not found'))
        }
        const result = create(
          found.value,
          await this.reservedSeats(tx, eventId),
        )
        if (Result.isFailure(result)) {
          return result
        }
        const d = reservationToEntity(result.value)
        await tx`INSERT INTO events.reservations (id, event_id, user_id, quantity, created_at)
          VALUES (${d.id}, ${d.event_id}, ${d.user_id}, ${d.quantity}, ${d.created_at})`
        return result
      }),
    )
  }

  async listReservations(userId: UserId) {
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(
      `SELECT ${reservationColumns} FROM events.reservations WHERE user_id = $1 ORDER BY created_at, id`,
      [userId],
    )
    return rows.map(reservationFromRow)
  }

  async cancelReservation(
    id: ReservationId,
    userId: UserId,
    change: (reservation: Reservation) => Result<Reservation, ApplicationError>,
  ): Promise<Result<Reservation, ApplicationError>> {
    return this.transaction(async (tx) => {
      const rows = await tx.unsafe<Record<string, unknown>[]>(
        `SELECT ${reservationColumns} FROM events.reservations WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [id, userId],
      )
      const found = Option.fromNullable(rows[0])
      if (Option.isNone(found)) {
        return Result.fail(new NotFound('Reservation not found'))
      }
      const updated = change(reservationFromRow(found.value))
      if (Result.isFailure(updated)) {
        return updated
      }
      const entity = reservationToEntity(updated.value)
      const cancelledAt = Option.getOrNull(entity.cancelled_at)
      await tx`UPDATE events.reservations SET cancelled_at = ${cancelledAt} WHERE id = ${id}`
      return updated
    })
  }

  async userExists(id: UserId) {
    const rows = await this.sql<
      { exist: boolean }[]
    >`SELECT EXISTS (SELECT id FROM events.users WHERE id = ${id}) as exist`
    return rows[0]!.exist
  }

  private async lockEvent(tx: SQL, id: EventId): Promise<Option<Event>> {
    const rows = await tx.unsafe<EventEntity[]>(
      `SELECT ${eventColumns} FROM events.events WHERE id = $1 FOR UPDATE`,
      [id],
    )
    return Option.map(Option.fromNullable(rows[0]), eventToDomain)
  }

  private async reservedSeats(tx: SQL, eventId: EventId): Promise<number> {
    const [row] = await tx<
      { seats: number }[]
    >`SELECT COALESCE(SUM(quantity), 0)::int AS seats
      FROM events.reservations WHERE event_id = ${eventId} AND cancelled_at IS NULL`
    return row.seats
  }

  private async write<Value>(
    operation: () => Promise<Result<Value, ApplicationError>>,
  ): Promise<Result<Value, ApplicationError>> {
    const result = await Result.tryPromise(operation, (cause) => {
      if (
        cause instanceof SQL.PostgresError &&
        (cause.errno === '23503' || cause.code === '23503')
      ) {
        return new InvalidInput('Referenced venue or user does not exist')
      }
      // Lost connections, corrupt SQL and driver faults are not business failures.
      throw cause
    })
    return Result.flatten(result)
  }
}
