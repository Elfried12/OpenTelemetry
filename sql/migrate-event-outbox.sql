BEGIN;
CREATE TABLE IF NOT EXISTS events.outbox (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id uuid NOT NULL UNIQUE,
  envelope jsonb NOT NULL,
  published_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON events.outbox(sequence) WHERE published_at IS NULL;
COMMIT;
