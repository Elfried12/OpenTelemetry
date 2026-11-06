import type { Generated } from 'kysely'
import type { EventEntity } from '#/features/events/infrastructure/event-entity.ts'
import type { ReservationEntity } from '#/features/events/infrastructure/reservation-entity.ts'

// These types describe query rows. sql/init.sql creates tables and seeds data.
export interface Database {
  users: { id: string }
  venues: { id: string; name: string; address: string }
  events: EventEntity
  reservations: Omit<ReservationEntity, 'created_at' | 'cancelled_at'> & {
    created_at: Generated<Date>
    cancelled_at: Generated<Date | null>
  }
}
