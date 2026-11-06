-- Run after migrate-bounded-contexts.sql and before the updated init.sql.
-- Preserves user IDs, reservations and notification references. Safe to rerun.
BEGIN;
CREATE SCHEMA IF NOT EXISTS identity;
DO $$
BEGIN
  IF to_regclass('identity.users') IS NULL THEN
    ALTER TABLE events.users SET SCHEMA identity;
    CREATE TABLE events.users (
      id uuid PRIMARY KEY REFERENCES identity.users(id)
    );
    INSERT INTO events.users (id) SELECT id FROM identity.users;
    -- Reservations belong to booking users, not directly to login accounts.
    DECLARE fk record;
    BEGIN
      FOR fk IN SELECT conname FROM pg_constraint
        WHERE conrelid = 'events.reservations'::regclass
          AND confrelid = 'identity.users'::regclass AND contype = 'f'
      LOOP
        EXECUTE format('ALTER TABLE events.reservations DROP CONSTRAINT %I', fk.conname);
      END LOOP;
    END;
    ALTER TABLE events.reservations ADD CONSTRAINT reservations_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES events.users(id);
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS identity.sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES identity.users(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON identity.sessions(user_id);
COMMIT;
