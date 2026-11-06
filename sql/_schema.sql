-- Current database schema without demo seed data.
-- Keep aligned with init.sql. events.users references identity.users.
BEGIN;

CREATE SCHEMA IF NOT EXISTS events;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS notifications;

CREATE TABLE IF NOT EXISTS identity.users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS identity.sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES identity.users(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON identity.sessions(user_id);

CREATE TABLE IF NOT EXISTS events.users (
  id uuid PRIMARY KEY REFERENCES identity.users(id)
);

CREATE TABLE IF NOT EXISTS events.venues (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  address text NOT NULL
);

CREATE TABLE IF NOT EXISTS events.events (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  category text NOT NULL CHECK (length(trim(category)) > 0),
  starts_at timestamptz NOT NULL,
  capacity integer NOT NULL CHECK (capacity > 0),
  venue_id uuid NOT NULL REFERENCES events.venues(id)
);
CREATE INDEX IF NOT EXISTS events_starts_at_idx ON events.events(starts_at);
CREATE INDEX IF NOT EXISTS events_category_starts_at_idx ON events.events(category, starts_at);

CREATE TABLE IF NOT EXISTS events.reservations (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events.events(id),
  user_id uuid NOT NULL REFERENCES events.users(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz
);
CREATE INDEX IF NOT EXISTS reservations_event_id_idx ON events.reservations(event_id);
CREATE INDEX IF NOT EXISTS reservations_user_id_idx ON events.reservations(user_id);

-- Notifications stores booking references as text, without foreign keys to Events.
CREATE TABLE IF NOT EXISTS notifications.recipients (
  id uuid PRIMARY KEY,
  booking_user_ref text NOT NULL UNIQUE,
  inbox_enabled boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS notifications.processed_messages (
  recipient_id uuid NOT NULL REFERENCES notifications.recipients(id),
  message_id uuid NOT NULL,
  PRIMARY KEY (recipient_id, message_id)
);

CREATE TABLE IF NOT EXISTS notifications.inbox (
  id uuid PRIMARY KEY,
  recipient_id uuid NOT NULL REFERENCES notifications.recipients(id),
  source_message_id uuid NOT NULL,
  booking_ref text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  read_at timestamptz,
  UNIQUE (recipient_id, source_message_id)
);
CREATE INDEX IF NOT EXISTS inbox_recipient_created_idx ON notifications.inbox(recipient_id, created_at, id);

COMMIT;
