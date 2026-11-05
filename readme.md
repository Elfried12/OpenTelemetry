# Day 2: Events REST API

A Hono API with two bounded contexts, Events and Notifications. Each context owns
its application logic, domain model and persistence. Events manages seats and
reservations. Notifications manages recipients, inbox preferences and read state.
They communicate through an in-process event bus, not shared repositories.

## Run locally

Requires Bun and Docker Compose. From this directory:

```sh
cp .env.example .env
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

## Interactive API documentation

Open [Scalar](http://127.0.0.1:3000/docs) to browse and try requests. The generated
OpenAPI 3.1 document is at [`/openapi.json`](http://127.0.0.1:3000/openapi.json).
Operations are grouped under Events, Reservations and Notifications, with request
and response examples, constraints and error responses. For personal endpoints,
set `X-User-Id` through Scalar's authentication control using a seeded demo user.

Route files own their operation documentation. The helpers in
`src/infrastructure/http/openapi.ts` reuse Valibot schemas and infer JSON example
types from them. `documentRoute` supplies shared errors and demo identity metadata;
`jsonBody`, `jsonResponse` and `parameter` handle the common OpenAPI structure.
The existing request validation still runs unchanged. Checks that JSON Schema
cannot express, such as future dates and a non-empty patch, are described in the
operation text and enforced by the existing validators and application code.

### HATEOAS for events and reservations

Event and reservation responses keep their existing fields and add `_links`.
Each link has a relative `href` and an HTTP `method`. This is an `application/json`
convention, not HAL. Lists remain arrays of resources, not new envelopes.

| Response | Available links |
| --- | --- |
| Future event, anonymous | `self`, `collection`, `update` |
| Future event, known `X-User-Id` | Also `reserve` and `reservations` |
| Started event | No `update` or `reserve`; known users still get `reservations` |
| Active reservation, owner | `event`, `collection`, `cancel` |
| Cancelled reservation, owner | `event`, `collection`, no `cancel` |

Create and update remain public in this demo. Supplying an identity is optional
on event reads and writes, but a malformed supplied ID returns `400` and an
unknown user returns `401`. Personalized event responses use
`Vary: X-User-Id` and `Cache-Control: private, no-store`.

In Scalar, select the anonymous, authenticated or started-event response example
on `GET /events/{eventId}`. To see the difference at runtime, request an event
without a header, then with a seeded user's `X-User-Id`. Follow `reserve` with
`{ "quantity": 1 }`, then the returned reservation's `cancel` link. The cancelled
response no longer advertises cancellation. Reservation routes still check the
owner, and reservation commands still check capacity. A link is not a guarantee
that a later request will succeed.

The schemas and presenters in `src/features/events/presentation/resources.ts`
own these relations. Domain objects and the underlying DTOs do not carry links.
Notification responses are unchanged.

## REST endpoints

| Endpoint                                          | Input                                                  | Concept                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `GET /events`                                     | Optional `category` and `after` query parameters       | Filter and list events. `after` is an exclusive start-date filter, not a pagination cursor. |
| `POST /events`                                    | `title`, `category`, `startsAt`, `capacity`, `venueId` | Create an event at an existing venue.                                                       |
| `GET /events/{eventId}`                           | Event ID in the path                                   | Read one event.                                                                             |
| `PATCH /events/{eventId}`                         | Non-empty partial event body                           | Update an event without reducing capacity below its active reservations.                    |
| `POST /events/{eventId}/reservations`             | `quantity`                                             | Reserve seats while checking remaining capacity.                                            |
| `GET /me/reservations`                            | `X-User-Id` header                                     | List the current demo user's reservations.                                                  |
| `POST /reservations/{reservationId}/cancellation` | Reservation ID and `X-User-Id` header                  | Cancel a reservation owned by the current demo user.                                        |

Notifications exposes its own endpoints, also using the demo `X-User-Id` header:

| Endpoint                                       | Input                       | Behavior                                                             |
| ---------------------------------------------- | --------------------------- | -------------------------------------------------------------------- |
| `GET /me/notifications`                        | Header                      | List only this recipient's inbox, oldest first.                      |
| `GET /me/notification-preferences`             | Header                      | Read the current inbox preference.                                   |
| `PATCH /me/notification-preferences`           | `{ "inboxEnabled": false }` | Opt out of future inbox messages.                                    |
| `POST /me/notifications/{notificationId}/read` | Header and notification ID  | Mark an owned message read. Repeating preserves its first timestamp. |

These operations return `200`. Unknown or unenrolled recipients receive `401`.
Another recipient's notification is hidden with `404`.

To demonstrate the context boundary with the seeded event:

```sh
# Events owns the reservation.
curl -s http://127.0.0.1:3000/events/01900000-0000-7000-8000-000000000004/reservations \
  -H 'X-User-Id: 01900000-0000-7000-8000-000000000001' \
  -H 'Content-Type: application/json' -d '{ "quantity": 1 }'

# Notifications owns the resulting inbox item. Its response is not a reservation DTO.
curl -s http://127.0.0.1:3000/me/notifications \
  -H 'X-User-Id: 01900000-0000-7000-8000-000000000001'

# Opt out here, then repeat the reservation request. The booking still succeeds,
# but Notifications does not add another inbox item.
curl -s -X PATCH http://127.0.0.1:3000/me/notification-preferences \
  -H 'X-User-Id: 01900000-0000-7000-8000-000000000001' \
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

Reservation operations require `X-User-Id`, using one of the seeded user IDs below.
This header is a demo identity mechanism, not authentication. Anyone can
impersonate a seeded user. Event creation and editing are public for this lesson.
Add authentication, organizer permissions and rate limits before deploying it.
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

This is a single-process lesson implementation. It scans and replaces the full
event list, not an indexed large-data read store. The bus currently awaits its
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
No additional inbox table or migration is needed.

The top-level feature folders name the business capabilities. This is screaming
architecture: open `src/features` and you see Events and Notifications rather
than a list of technical layers. Each feature keeps its own technical layers.
The [bounded-context guide](src/features/bounded-contexts.md) explains why this
split also requires separate models and explicit contracts, not just new folders.

Events publishes `EventCreated`, `EventUpdated`, `EventReserved` and
`ReservationCancelled` through [its contract](src/features/events/contracts/events.ts).
Notifications' [subscriber](src/features/notifications/infrastructure/events-subscriber.ts)
translates reservation facts into local `BookingNotice` inputs. Creation and update
facts are logged but do not produce inbox items. The Notifications subscriber
never loads an Events entity or calls its repository. The separate read-model
subscriber belongs to Events and only updates its own Valkey projection.

The same person has different models in the two contexts:

| Events                                                  | Notifications                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| `UserId`, name, email, reservations                     | Recipient ID, opaque booking-user reference, inbox preference |
| Reservation with quantity, event and cancellation state | Notification with subject, body and read timestamp            |
| Capacity and booking ownership rules                    | Opt-out, duplicate suppression and inbox ownership rules      |

Recipients have their own IDs. Alice's recipient ID ends in `0101`, while her
booking user ID ends in `0001`. The reference connects identities, not database
models. It is text, has no cross-context foreign key and cannot be used to join
through a Notifications repository. Notifications needs neither a user's name
nor their email for this in-app inbox. Recipients are enrolled separately by demo
seed data. Unknown recipients are ignored, not fetched from Events.

Notification delivery records a source message ID atomically with an inbox item.
Replaying a message cannot duplicate the item. Opted-out messages are recorded as
processed too, so replay after opting back in does not resurrect old messages.
Marking an item read preserves the first read timestamp and is scoped to its owner.

The bus awaits subscribers and isolates their failures, but it is not durable.
Booking commits before publication. A process crash or failed subscriber can lose
a notification. This lesson does not claim reliable delivery or exactly-once
processing. An outbox, durable broker and retry/dead-letter policy are the next
steps for production.

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
  infrastructure/
    di/                 Generic container and composition tokens
    messaging/          In-process event bus
    http/               Shared HttpStatusCode enum
sql/init.sql            Both PostgreSQL schemas and independent seed data
sql/migrate-bounded-contexts.sql  Moves existing public tables to events
```

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
- [Events and the in-memory bus](src/infrastructure/messaging/event-bus.md): facts versus commands, publication after commit and delivery failures.
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

One PostgreSQL database contains two schemas. The three Events PostgreSQL adapters
all query `events.*`. Notifications always uses PostgreSQL, including when Events
uses Valkey. Switching the Events backend does not move or reset the inbox.

`sql/init.sql` creates four tables in the `events` schema:

| Table          | Columns and role                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `users`        | `id`, `name`, unique `email`. Users who can reserve seats.                                                                 |
| `venues`       | `id`, `name`, `address`. Locations that host events.                                                                       |
| `events`       | `id`, `title`, `category`, `starts_at`, `capacity`, `venue_id`. Each event belongs to a venue.                             |
| `reservations` | `id`, `event_id`, `user_id`, `quantity`, `created_at`, nullable `cancelled_at`. Each reservation links a user to an event. |

```text
venues 1 ---- * events 1 ---- * reservations * ---- 1 users
```

Notifications owns `notifications.recipients`, `notifications.inbox` and
`notifications.processed_messages`. Only context-local foreign keys exist.
`booking_user_ref` and `booking_ref` are opaque text references to external facts,
not foreign keys to Events. Schema separation expresses ownership, not database
permission isolation: this local demo uses one PostgreSQL role for both contexts.

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
