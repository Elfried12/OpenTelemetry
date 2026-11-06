# Events REST API

A Hono API with Identity, Events and Notifications contexts. Identity owns fake
login accounts and revocable sessions. Events manages seats and reservations.
Notifications manages recipients, inbox preferences and read state. Events and
Notifications communicate through an in-process event bus, not shared repositories.

## Run locally

Requires Bun and Docker Compose. From this directory:

```sh
cp .env.example .env
printf '\nAPPLICATION_SECRET_KEY=%s\n' "$(openssl rand -hex 32)" >> .env
bun install
docker compose up -d --wait
bun run dev
```

The API listens on http://127.0.0.1:3000. PostgreSQL is available on
localhost:55432, and Adminer on http://localhost:8080.

## Environment variables

Bun loads the API configuration from `.env`. Docker Compose uses the same file
for the published service ports and PostgreSQL credentials. `.env.example` contains
the local demo settings. `POSTGRES_DB`, `POSTGRES_USER` and `POSTGRES_PASSWORD`
default to `events`. Keep `DATABASE_URL` in sync with those values and
`POSTGRES_PORT`. PostgreSQL only applies initialization credentials to an empty
volume; changing `.env` does not change an existing database's password or roles.

`APPLICATION_SECRET_KEY` is required and must contain at least 32 characters.
Generate it with `openssl rand -hex 32` and keep it private in `.env` or your
secret manager. All API instances must use the same key to resolve and revoke
shared sessions. Changing the key invalidates existing sessions. Sessions stored
with the previous unkeyed SHA-256 hashing also require a new login.

| Variable           | Default                                           | Purpose                                                                            |
| ------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `PORT`             | `3000`                                            | HTTP port for the API, bound to `127.0.0.1`.                                       |
| `EVENT_REPOSITORY` | `postgres`                                        | Storage adapter: `postgres`, `kysely`, `drizzle`, `valkey` or `valkey-functional`. |
| `DATABASE_URL`     | `postgres://events:events@localhost:55432/events` | PostgreSQL connection URL for the raw SQL, Kysely and Drizzle adapters.            |
| `POSTGRES_PORT`    | `55432`                                           | Host port Docker Compose publishes for PostgreSQL.                                 |
| `VALKEY_URL`       | `redis://localhost:56379`                         | Connection URL for either Valkey adapter.                                          |
| `VALKEY_PORT`      | `56379`                                           | Host port Docker Compose publishes for Valkey.                                     |
| `ADMINER_PORT`     | `8080`                                            | Host port for the Adminer database interface.                                      |

If you change `POSTGRES_PORT`, update the port in `DATABASE_URL` too. The same
applies to `VALKEY_PORT` and `VALKEY_URL`. Restart the API after changing its
configuration, and rerun `docker compose up -d --wait` after changing service ports.
No model API key is needed.

## Rate limiting

See [Rate limiting](src/platform/rate-limit/rate-limiting.md) for the
default policy, configuration, bucket algorithms and storage constraints.

## Interactive API documentation

Open [Scalar](http://127.0.0.1:3000/docs) to browse and try requests. The generated
OpenAPI 3.1 document is at [`/openapi.json`](http://127.0.0.1:3000/openapi.json).
Operations are grouped under Identity, Events, Reservations and Notifications.
First call `POST /user/auth` with `{ "userId": "01900000-0000-7000-8000-000000000001" }`.
Copy the returned `token` into Scalar's Bearer authentication control, without
adding the `Bearer` prefix. Personal endpoints require this session.
`DELETE /user/auth` revokes the current session and returns `204`.
Sessions expire after 24 hours. Unknown, expired and revoked tokens return `401`.

Each route file documents its operations. The helpers in
`src/platform/http/openapi.ts` reuse Valibot schemas and infer JSON example
types from them. `documentRoute` adds shared error responses and session requirements.
`jsonBody`, `jsonResponse` and `parameter` build the OpenAPI descriptions.
Validators and application code check rules that JSON Schema cannot express,
such as future dates and a non-empty patch. The operation descriptions explain
these rules too.

For the implementation choices, see
[OpenAPI and living documentation](src/platform/http/openapi.md).
It connects the schema and test setup to Cyrille Martraire's book
_Living Documentation: Continuous Knowledge Sharing by Design_.

### HATEOAS for events and reservations

Event and reservation responses include `_links` alongside their data fields.
Each link has a relative `href` and an HTTP `method`. This is an `application/json`
convention, not HAL. Lists return arrays of resources without a wrapper object.

| Response                           | Available links                                                |
| ---------------------------------- | -------------------------------------------------------------- |
| Future event, anonymous            | `self`, `collection`, `update`                                 |
| Future event, valid bearer session | Also `reserve` and `reservations`                              |
| Started event                      | No `update` or `reserve`; known users still get `reservations` |
| Active reservation, owner          | `event`, `collection`, `cancel`                                |
| Cancelled reservation, owner       | `event`, `collection`, no `cancel`                             |

Anyone can create or update events in this demo. Event reads and writes accept
requests without a session, but reject malformed, unknown, expired or revoked
bearer tokens with `401`. Personalized event responses use
`Vary: Authorization` and `Cache-Control: private, no-store`.

In Scalar, select the anonymous, authenticated or started-event response example
on `GET /events/{eventId}`. To see the difference at runtime, request an event
without a header, then with a user's bearer session. Follow `reserve` with
`{ "quantity": 1 }`, then the returned reservation's `cancel` link. The cancelled
response no longer advertises cancellation. Reservation routes still check the
owner, and reservation commands still check capacity. A link is not a guarantee
that a later request will succeed.

The schemas and presenters in `src/features/events/presentation/resources.ts`
define these links. Domain objects and the underlying DTOs do not carry links.
Notification responses do not include them.

See [HATEOAS and action links](src/features/events/presentation/hateoas.md) for
why links belong in presentation and why commands must still check their rules.

## REST endpoints

| Endpoint                                          | Input                                                  | Concept                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `GET /events`                                     | Optional `category` and `after` query parameters       | Filter and list events. `after` is an exclusive start-date filter, not a pagination cursor. |
| `POST /events`                                    | `title`, `category`, `startsAt`, `capacity`, `venueId` | Create an event at an existing venue.                                                       |
| `GET /events/{eventId}`                           | Event ID in the path                                   | Read one event.                                                                             |
| `PATCH /events/{eventId}`                         | Non-empty partial event body                           | Update an event without reducing capacity below its active reservations.                    |
| `POST /events/{eventId}/reservations`             | `quantity`                                             | Reserve seats while checking remaining capacity.                                            |
| `GET /me/reservations`                            | Bearer session                                         | List the current demo user's reservations.                                                  |
| `POST /reservations/{reservationId}/cancellation` | Reservation ID and bearer session                      | Cancel a reservation owned by the current demo user.                                        |

Notifications exposes its own endpoints, using the same bearer session:

| Endpoint                                       | Input                       | Behavior                                                             |
| ---------------------------------------------- | --------------------------- | -------------------------------------------------------------------- |
| `GET /me/notifications`                        | Header                      | List only this recipient's inbox, oldest first.                      |
| `GET /me/notification-preferences`             | Header                      | Read the current inbox preference.                                   |
| `PATCH /me/notification-preferences`           | `{ "inboxEnabled": false }` | Opt out of future inbox messages.                                    |
| `POST /me/notifications/{notificationId}/read` | Header and notification ID  | Mark an owned message read. Repeating preserves its first timestamp. |

These operations return `200`. Unknown or unenrolled recipients receive `401`.
Another recipient's notification is hidden with `404`.

To demonstrate the context boundary with the seeded event, create a session first.
Anyone who knows a user UUID can obtain a token. The demo does not verify identity.

```sh
curl -s http://127.0.0.1:3000/user/auth \
  -H 'Content-Type: application/json' \
  -d '{ "userId": "01900000-0000-7000-8000-000000000001" }'

# Paste the response's token here.
TOKEN='PASTE_TOKEN_HERE'

# Events owns the reservation.
curl -s http://127.0.0.1:3000/events/01900000-0000-7000-8000-000000000004/reservations \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{ "quantity": 1 }'

# Notifications owns the resulting inbox item. Its response is not a reservation DTO.
curl -s http://127.0.0.1:3000/me/notifications \
  -H "Authorization: Bearer $TOKEN"

# Opt out here, then repeat the reservation request. The booking still succeeds,
# but Notifications does not add another inbox item.
curl -s -X PATCH http://127.0.0.1:3000/me/notification-preferences \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{ "inboxEnabled": false }'
```

Event creation and seat reservation return `201`. Other successful operations
return `200`. Event creation also returns a `Location` header. Lists return arrays,
sorted by date and ID, without pagination.

Requests reject unknown fields, and timestamps must include a timezone. Events
must start in the future. Capacity and reservation quantity must be positive
32-bit integers. A user can make multiple reservations for the same event.
Cancellation records a timestamp instead of deleting the reservation. It is
allowed after the event starts, but cannot be repeated.

Reservation operations require `Authorization: Bearer <token>`.
Create a session with a seeded user UUID at `POST /user/auth`. Anyone can
impersonate a known user this way. The server generates random tokens and stores
only their HMAC-SHA-256 hashes, keyed by `APPLICATION_SECRET_KEY`. Each session can be revoked separately.
`X-User-Id` no longer authenticates requests. Event creation and editing remain
public. Add real identity verification, organizer permissions and rate limits
before deploying.

Writes are not idempotent, so do not automatically retry a timed-out reservation.

## Architecture

```text
Events commands -> Events domain -> authoritative repository, PostgreSQL by default
                       |
                 in-memory event bus
                       |
           +-----------+------------------+
           |                              |
Events read-model subscriber    Notifications translation adapter
           |                              |
Valkey event read model          PostgreSQL notifications.inbox
           |                              |
Events queries                  Notifications queries
```

### Event read model and user inbox

The running API uses two event repositories. `EVENT_REPOSITORY` selects the
write-side adapter. `GET /events` and `GET /events/{eventId}` use a separate
`ValkeyEventReadRepository`, connected through `VALKEY_URL`. Identity, reservation
queries and all commands still use the authoritative repository. A stale read
model cannot bypass capacity checks.

The Events read-model subscriber listens to `EventCreated` and `EventUpdated`.
It reloads committed events and atomically replaces a Valkey snapshot at
`events:read-model:v1`. Refreshes are serialized within the process, and replayed
messages reload current state rather than overwriting it with old payloads.
Startup rebuilds the projection before accepting traffic, including seeded events.
Tests and embedded callers can omit `readRepository` to use one repository.

This lesson runs in one process. Each refresh scans and replaces the full
event list, so it is not suitable for large datasets. The bus currently awaits its
subscribers, but projection writes are separate from the authoritative commit.
Subscriber failures are logged and do not roll back commands. A subsequent event
refresh or application restart repairs the snapshot. There is no durable retry,
periodic repair or cross-process ordering guarantee. Use an outbox and an ordered
projection worker before running multiple API processes or requiring recovery
without a restart.

Notifications already has its own PostgreSQL inbox read model. Each row in
`notifications.inbox` contains the recipient, subject, body, booking reference,
creation time and read state. The `(recipient_id, created_at, id)` index supports
owner-scoped retrieval in display order without joining Events tables. The
subscriber records message deduplication and the inbox item in one transaction.

The folders in `src/features` group code by business capability. Identity,
Events and Notifications each contain their own application code and adapters.
The [bounded-context guide](src/features/bounded-contexts.md) explains their
separate models and the contracts they use to communicate.

Events publishes `EventCreated`, `EventUpdated`, `EventReserved` and
`ReservationCancelled` through [its contract](src/features/events/contracts/events.ts).
Notifications' [subscriber](src/features/notifications/infrastructure/events-subscriber.ts)
translates reservation facts into local `BookingNotice` inputs. Creation and update
facts are logged but do not produce inbox items. The Notifications subscriber
never loads an Events entity or calls its repository. The separate read-model
subscriber belongs to Events and only updates its own Valkey projection.

Events and Notifications model the same person differently:

| Events                                                  | Notifications                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| `UserId`, reservations                                  | Recipient ID, opaque booking-user reference, inbox preference |
| Reservation with quantity, event and cancellation state | Notification with subject, body and read timestamp            |
| Capacity and booking ownership rules                    | Opt-out, duplicate suppression and inbox ownership rules      |

Recipients have their own IDs. Alice's recipient ID ends in `0101`, while her
booking user ID ends in `0001`. Notifications stores the booking user ID as text,
without a foreign key to Events. Its repository cannot use that reference to load
an Events user. Notifications needs neither a user's name nor their email for
this in-app inbox. Recipients are enrolled separately by demo
seed data. Unknown recipients are ignored, not fetched from Events.

Notification delivery records a source message ID atomically with an inbox item.
Replaying a message cannot duplicate the item. Opted-out messages are recorded as
processed too, so replay after opting back in does not resurrect old messages.
Marking an item read preserves the first read timestamp and is scoped to its owner.

The bus awaits subscribers and isolates their failures, but it is not durable.
Booking commits before publication. A process crash or failed subscriber can lose
a notification. The bus does not guarantee delivery or exactly-once processing.
For production, add an outbox, a durable broker, retries and a policy for messages
that keep failing.

- Routes define endpoints and validate incoming requests.
- Controllers translate HTTP requests into application calls and format responses.
- Application operations coordinate event creation, updates, reservations and cancellation.
- The domain defines event and reservation rules, including capacity and ownership.
- The repository interface lets application operations use storage without depending
  on a specific database library.
- Infrastructure adapters implement persistence and map stored records to domain data.
- Presenters define the public response DTOs, separate from database records.

```text
src/
  bootstrap.ts          Local HTTP server and adapter selection
  composition-root.ts   Wiring and event subscription
  app.ts                Hono application setup
  features/
    identity/
      application/      Session creation, lookup, revocation and repository port
      infrastructure/   In-memory and PostgreSQL identity repositories
      routes/           Session endpoints and bearer-token middleware
    events/
      contracts/        Published event facts, no domain-entity imports
      application/      Booking commands, queries, identity and ports
      domain/           Event, reservation, capacity and branded identifiers
      infrastructure/   Events persistence adapters and row mappings
      controllers/      Events HTTP translation
      routes/           Events and reservation endpoints
      presentation/     Events response DTOs and presenters
      validation.ts     Events request schemas
      request.ts        Events request parsing and demo identity
    notifications/
      application/      Inbox, preferences, read state and repository port
      domain/           Recipient, notification and booking-notice models
      infrastructure/   Event translation and notification repositories
      routes/           Notifications HTTP boundary and input validation
  shared-kernel/        Result, Option, handler and messaging abstractions
  platform/             Technical modules shared across features
    di/                 Generic container and composition tokens
    messaging/          In-process event bus
    http/               Shared HTTP status codes, schemas and OpenAPI helpers
    rate-limit/
      domain/           Bucket policies and persistent timestamp queue
      application/      Rate limiter, repository port and storage errors
      infrastructure/   In-memory repository and indexed expiration heap
      http/             Middleware, quota headers and HTTP error mapping
sql/init.sql            Three PostgreSQL schemas and seed data
sql/migrate-identity-sessions.sql  Splits login accounts from booking profiles
sql/migrate-bounded-contexts.sql  Moves existing public tables to events
```

Business capabilities live in `features/`; shared technical capabilities live in
`platform/`. A platform module can have its own domain rules and application
orchestration. `infrastructure/` inside a module contains concrete adapters, not
other architectural layers. Rate limiting follows this structure without making
it part of the booking domain. See the [platform guide](src/platform/platform.md).

The domain and application layers do not depend on Hono or Valibot.
`test/bounded-contexts.test.ts` guards the cross-context import rule. The HTTP layer
uses Valibot to validate requests and responses. Imports use the `#/*` alias defined
in `package.json` and `tsconfig.json`.

### Design guides beside the code

These guides explain the patterns through this lesson's implementation:

- [Domain](src/features/events/domain/domain.md): business rules and application coordination.
- [Domain entities](src/features/events/domain/entities.md): identity across updates and cancellation.
- [Value objects](src/features/events/domain/value-objects.md): capacity validation and value equality.
- [Branded types](src/features/events/domain/branded-types.md): distinct identifier types and runtime validation.
- [Repository pattern](src/features/events/infrastructure/repository/repository-pattern.md): storage contracts and protected mutations.
- [Database entities](src/features/events/infrastructure/entities.md): rows versus domain entities and their mappings.
- [Errors as values](src/shared-kernel/errors-as-values.md): expected failures, absence and exceptions.
- [Shared kernel](src/shared-kernel/shared-kernel.md): common types and dependency boundaries.
- [DTOs and presenters](src/features/events/presentation/dto-and-presenter.md): public JSON versus internal representations.
- [Controllers](src/features/events/controllers/controller.md): HTTP translation without business or persistence rules.
- [Application services](src/features/notifications/application/application-service.md): orchestration, domain behavior, controllers and transaction boundaries, using Notifications and Events as examples.
- [Services and dependency injection](src/features/events/application/dependency-injection.md): explicit dependencies, tokens, lifetimes and composition-root ownership.
- [Events and the in-memory bus](src/platform/messaging/event-bus.md): facts versus commands, publication after commit and delivery failures.
- [Bounded contexts and feature folders](src/features/bounded-contexts.md): model ownership, contract translation and schema boundaries.
- [BDD and fluent test APIs](test/bdd.md): behavior-focused scenarios, given/when/then and method chaining.
- [Functions as values and execution policies](src/features/events/infrastructure/repository/functional-composition.md): higher-order functions, predicates and retry composition.
- [AbortController and deadlines](src/features/events/infrastructure/repository/abort-controller.md): cooperative cancellation, timeout cleanup and uncertain write outcomes.

### Persistence adapters

Select an adapter through `EVENT_REPOSITORY`:

| Value               | Approach                                                       |
| ------------------- | -------------------------------------------------------------- |
| `postgres`          | Raw SQL through Bun's SQL client. Default adapter.             |
| `kysely`            | Typed SQL query builder using the `pg` driver.                 |
| `drizzle`           | ORM with TypeScript table declarations, using the `pg` driver. |
| `valkey`            | JSON snapshot storage with atomic compare-and-set writes.      |
| `valkey-functional` | Valkey variant that composes retry and timeout functions.      |

For example:

```sh
EVENT_REPOSITORY=kysely bun run dev
EVENT_REPOSITORY=drizzle bun run dev
```

The three PostgreSQL adapters share the same tables and records. Switching between
them does not copy or reset data. They lock the event row inside a transaction
before checking reserved seats and writing a reservation or capacity change. This
prevents concurrent requests from overbooking an event.

`sql/init.sql` owns the database schema. Kysely and Drizzle schemas describe those
tables for queries. Editing the TypeScript descriptions does not change the database.
There is no code generation or migration runner.

Valkey stores independent data in the `valkey_data` Docker volume with append-only
persistence. It recognizes the same demo user and venue IDs, but starts without
events. Create an event through the API before reserving seats. Switching between
PostgreSQL and Valkey does not migrate records.

The Valkey adapters read a single snapshot and retry conflicting writes through
an atomic Lua compare-and-set operation. This is a small-demo design, not a storage
approach for large datasets. The functional variant limits a mutation to 32 attempts
and a five-second deadline. A timeout cannot undo a command already sent to Valkey.

An in-memory repository is also available for tests, but is not a selectable server
backend.

## Database structure

One PostgreSQL database contains three schemas. Identity owns `identity.users`
with name and email, and `identity.sessions` with token hash, user ID, creation,
expiration and revocation timestamps. Events stores booking profiles in
`events.users`. Each profile's primary key references `identity.users.id`, so
existing booking IDs do not change. Reservations reference the booking profile,
not the session or credentials. The three Events PostgreSQL adapters query
`events.*`. Notifications always uses PostgreSQL, including when Events
uses Valkey. Switching the Events backend does not move or reset the inbox.

`sql/init.sql` creates four tables in the `events` schema:

| Table          | Columns and role                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `users`        | `id`, referencing `identity.users.id`. Booking-specific user profile.                                                      |
| `venues`       | `id`, `name`, `address`. Locations that host events.                                                                       |
| `events`       | `id`, `title`, `category`, `starts_at`, `capacity`, `venue_id`. Each event belongs to a venue.                             |
| `reservations` | `id`, `event_id`, `user_id`, `quantity`, `created_at`, nullable `cancelled_at`. Each reservation links a user to an event. |

```text
venues 1 ---- * events 1 ---- * reservations * ---- 1 users
```

Notifications owns `notifications.recipients`, `notifications.inbox` and
`notifications.processed_messages`. Its foreign keys stay within the context.
The Events booking-user key references Identity's user key.
`booking_user_ref` and `booking_ref` are opaque text references to external facts,
not foreign keys to Events. Separate schemas show which context owns each table.
They do not restrict database access. This demo uses one PostgreSQL role for all
three contexts.

All primary IDs are UUIDs. The domain requires lowercase UUID v7 identifiers. Foreign keys
connect events to venues and reservations to events and users. SQL constraints
require non-empty event titles and categories, positive capacity and positive
reservation quantities.

Indexes support event date/category filters and reservation lookups by event or
user. Only reservations without a cancellation timestamp count toward occupied seats.

### Default entries

PostgreSQL starts with the following records from `sql/init.sql`. There are no
seeded reservations.

| Record           | UUID v7                                | Details                                                                                |
| ---------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| Alice            | `01900000-0000-7000-8000-000000000001` | `alice@example.com`                                                                    |
| Bob              | `01900000-0000-7000-8000-000000000002` | `bob@example.com`                                                                      |
| Game room        | `01900000-0000-7000-8000-000000000003` | `12 rue du Jeu, Paris`                                                                 |
| Board game night | `01900000-0000-7000-8000-000000000004` | Category `gaming`, starts at `2099-06-15T18:00:00Z`, capacity 20, hosted in Game room. |

Compose runs the initialization SQL only when the PostgreSQL volume is empty.
To apply it manually to the current database:

```sh
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U events -d events < sql/init.sql
```

Existing rows are kept. Rerunning this file does not reset edited records.

If your database already contains this lesson's tables in `public`, migrate them
**before** running `init.sql`. Back up the database first:

```sh
docker compose exec -T postgres pg_dump -U events -d events > /tmp/events-before-contexts.sql
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U events -d events < sql/migrate-bounded-contexts.sql
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U events -d events < sql/init.sql
```

The migration moves tables with their data and foreign keys. It aborts rather than
merging if both schemas already contain the same table. Notifications seed data
is independent; rerunning `init.sql` does not overwrite existing preferences.

### Migrate existing users and add sessions

For a database already using the `events` schema, stop the API and back up first:

```sh
./scripts/backup.sh
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U events -d events < sql/migrate-identity-sessions.sql
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U events -d events < sql/init.sql
bun run dev
```

The migration moves the existing user table into Identity and creates booking
profiles with the same IDs. It updates reservation foreign keys without deleting
records. Rerunning it leaves migrated records intact. For older `public` tables,
run the UUID and bounded-context migrations first. Fresh volumes need only
`init.sql`.

### Back up and restore PostgreSQL

Both scripts use `.env` and PostgreSQL tools inside the running Compose container.
Backups contain schema and data in one plain SQL file, not Valkey data or roles.

```sh
docker compose up -d --wait
./scripts/backup.sh ./backups/before-changes.sql
./scripts/restore.sh ./backups/before-changes.sql
```

Without a path, backup writes `backups/backup-<UTC timestamp>.sql`. Existing files
are not overwritten, and `backups/` is ignored by Git.

**Restore replaces objects included in the backup and their data.** Stop the API
and other writers first. Only restore trusted SQL. Errors roll back the restore.
Restart the API afterward to rebuild its Valkey read model.

### Inspect the database

Open http://localhost:8080 and select PostgreSQL:

| Field    | Value      |
| -------- | ---------- |
| Server   | `postgres` |
| Username | `events`   |
| Password | `events`   |
| Database | `events`   |

Adminer connects through the Compose service name `postgres`, not `localhost`.
These credentials and loopback-only service bindings are intended for local use.

### Older UUID-v4 data

Older demo data with UUID-v4 identifiers is incompatible with the current domain.
Back it up and run the data-preserving migration before rerunning the seed file:

```sh
docker compose exec -T postgres pg_dump -U events -d events > /tmp/events-before-uuid-v7.sql
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U events -d events < sql/migrate-uuid-v7.sql
```

Run the UUID migration on the old `public` tables before the bounded-context
migration above. It updates identifiers and foreign keys in one transaction and
prints the old-to-new mapping. It preserves existing UUID-v7 records.

For disposable lesson data, you can reset the volumes instead. **This deletes all
local PostgreSQL and Valkey records.**

```sh
docker compose down -v
docker compose up -d --wait
```

## Checks

```sh
bun run check
bun run test
```

`check` verifies formatting, lint rules and TypeScript types. The test suite covers
application operations, REST endpoints, context import boundaries and repository
contracts. Notification repository tests cover both memory and PostgreSQL,
including concurrent replay, preferences and owner-scoped read state. Repository tests
require Docker and use disposable containers, not the demo database.
