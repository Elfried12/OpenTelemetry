import type { SQL } from 'bun'
import * as v from 'valibot'
import type { OutboxStore } from '#/features/events/application/ports.ts'
import type { DomainEvent } from '#/features/events/contracts/events.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'

const date = v.pipe(
  v.string(),
  v.isoTimestamp(),
  v.transform((value) => new Date(value)),
)
const eventDetails = v.object({
  eventId: v.string(),
  title: v.string(),
  category: v.string(),
  startsAt: date,
  capacity: v.number(),
  venueId: v.string(),
})
const reservationDetails = v.object({
  reservationId: v.string(),
  eventId: v.string(),
  userId: v.string(),
  quantity: v.number(),
})
const envelopeSchema = v.object({
  messageId: v.string(),
  occurredAt: date,
  version: v.literal(1),
  event: v.variant('_tag', [
    v.object({ _tag: v.literal('EventCreated'), content: eventDetails }),
    v.object({ _tag: v.literal('EventUpdated'), content: eventDetails }),
    v.object({ _tag: v.literal('EventReserved'), content: reservationDetails }),
    v.object({
      _tag: v.literal('ReservationCancelled'),
      content: reservationDetails,
    }),
  ]),
})

export class PostgresOutboxStore implements OutboxStore {
  constructor(private readonly sql: SQL) {}

  async deliverNext(
    deliver: (envelope: EventEnvelope<DomainEvent>) => Promise<void>,
  ): Promise<boolean> {
    return this.sql.begin(async (tx) => {
      const [row] = await tx<{ sequence: string; envelope: unknown }[]>`
        SELECT sequence, envelope FROM events.outbox
        WHERE published_at IS NULL ORDER BY sequence LIMIT 1 FOR UPDATE SKIP LOCKED`
      if (!row) {
        return false
      }
      await deliver(v.parse(envelopeSchema, row.envelope))
      await tx`UPDATE events.outbox SET published_at = now() WHERE sequence = ${row.sequence}`
      return true
    })
  }
}
