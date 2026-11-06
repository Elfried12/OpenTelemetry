import { integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'

const eventsSchema = pgSchema('events')

// Query descriptions, not migrations. sql/init.sql owns constraints and indexes.
export const users = eventsSchema.table('users', {
  id: uuid().primaryKey(),
})

export const venues = eventsSchema.table('venues', {
  id: uuid().primaryKey(),
  name: text().notNull(),
  address: text().notNull(),
})

export const events = eventsSchema.table('events', {
  id: uuid().primaryKey(),
  title: text().notNull(),
  category: text().notNull(),
  starts_at: timestamp({ withTimezone: true }).notNull(),
  capacity: integer().notNull(),
  venue_id: uuid().notNull(),
})

export const reservations = eventsSchema.table('reservations', {
  id: uuid().primaryKey(),
  event_id: uuid().notNull(),
  user_id: uuid().notNull(),
  quantity: integer().notNull(),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  cancelled_at: timestamp({ withTimezone: true }),
})
