# Container and dependency injection

Dependency injection means supplying dependencies from outside an object instead
of having that object construct them. Events command handlers receive a repository,
clock, ID generator and event bus through their constructors. Query handlers need
only a repository. Neither resolves tokens, opens database connections or depends
on Hono.

Notifications follows the same rule. Its application service receives its own
repository port and functions for generating IDs and reading the clock. See
[Application services](../../notifications/application/application-service.md) for
its orchestration responsibilities and how they differ from domain behavior.

## Start with ordinary constructor arguments

Dependency injection does not require a container. A caller could construct a
handler directly:

```ts
const reserve = new ReserveEventUseCase(repository, clock, ids, eventBus)
await reserve.execute(command)
```

Those arguments expose what the operation needs. A query receives only the
repository because reading events needs neither a clock nor publication. Tests
can supply a fixed clock or an in-memory adapter without changing the handler.

Constructing a PostgreSQL repository inside `execute` would hide configuration,
connection lifetime and storage choice inside the operation. Passing a container
to `execute` would hide its dependencies behind token lookups instead. Both make
the caller work harder to understand what the operation requires.

## Composition root

A composition root is the place that chooses implementations and connects them.
It is allowed to know concrete classes from several layers because assembling
the application is its job. The application handlers do not make those choices.

The generic [container](../../../platform/di/container.ts) implements typed
singleton and factory registrations. It has no application registrations.
[Token creation](../../../platform/di/token.ts) is separate from the
[application token registry](../../../platform/di/tokens.ts).

That split keeps the mechanism independent of this lesson's business names.
`Container` knows how to register and resolve a value. `TOKEN` names the values
this application needs. `createContainer` defines how to build them. Adding a
Notifications registration changes the wiring, not the generic container.

The [composition root](../../../composition-root.ts) supplies dependencies for
both contexts, registers controllers and installs the Notifications subscription.
Registrations are singletons within one container. Separate containers have
independent apps and event buses unless a caller explicitly supplies shared
adapters. Controllers receive explicit dependencies, not a container or Services
bag.

[bootstrap.ts](../../../bootstrap.ts) selects the Events
[persistence adapter](../infrastructure/persistence.ts), supplies the PostgreSQL
Notifications adapter, creates the container and resolves the HTTP app. Shutdown
unsubscribes Notifications and closes both persistence clients. The Events
PostgreSQL, Kysely, Drizzle and Valkey adapters use the same application handlers.

The root [app.ts](../../../app.ts) sets up the Hono application and Events routes.
Notifications installs its own routes. Neither context depends on the
other's controllers or identity service.

Tests use the same `createContainer` with in-memory repositories and controlled
time. The [application fixture](../../../../test/support/application-fixture.ts)
keeps its convenience handler grouping locally; it is not a production service
locator.

## Tokens and lifetimes

TypeScript interfaces do not exist at runtime, so the container cannot use
`EventRepository` itself as a lookup key. A `Token<EventRepository>` pairs a
runtime symbol with a compile-time service type. Its description is for error
messages. Two tokens with the same description still have different symbols.

Registration stores a construction function; it does not immediately call it.
On resolution, a singleton calls that function once and keeps the result. A
factory calls it on every resolution. The application root currently uses
singletons for its registrations. Here singleton means once per container, not
one global object for the entire process.

Missing registrations, duplicate registrations and circular resolution throw
container errors. These are wiring mistakes, not expected booking rejections.
The container does not replace the application's `Result`-based error handling.

The container also does not manage resource disposal. `bootstrap.ts` owns the
clients it opens and closes them explicitly during shutdown. Registering an
adapter as a singleton does not teach the container how to close its connection.

## Event publication and subscription

The [event bus port](../../../shared-kernel/event-bus.ts) belongs in the shared
kernel. Its [in-memory adapter](../../../platform/messaging/in-memory-event-bus.ts)
belongs in infrastructure. The root chooses that adapter and supplies the same
instance to Events handlers and the Notifications subscription. Neither context
constructs the bus or discovers the other through the container.

See [events and the in-memory bus](../../../platform/messaging/event-bus.md)
for the published contract, commit-before-publication sequence and failure policy.

The [Notifications subscriber](../../notifications/infrastructure/events-subscriber.ts)
is installed once during container creation, even when a caller resolves a use
case without resolving the HTTP app. It logs incoming facts and translates
reservation facts into local notification inputs. `TOKEN.NotificationSubscription`
resolves to an idempotent unsubscribe function.

This subscription is the deliberate exception to lazy construction. The root
resolves it before returning the container. Otherwise a command resolved directly
in a test or job could publish before anything had subscribed. Keeping it out of
controller construction also prevents repeated controller resolution from adding
listeners. Shutdown calls the unsubscribe function after stopping the HTTP server.

The bus is process-local and has no durable delivery or replay. A crash between
persistence and publication can lose a notification. The Notifications repository
can suppress duplicate deliveries, but that does not make the bus reliable.

## Injection and inversion

Injection is how an implementation is supplied. Dependency inversion is about
which module owns the abstraction. Each context's application layer owns its
repository port; its infrastructure implements that port. The handler imports
`EventRepository` from the application, and the PostgreSQL adapter implements it.
The source dependency points toward the application even though the runtime call
goes from the handler to the adapter. That is dependency inversion.

Domain entities receive data such as time and reserved-seat counts, not a
container or repository.

Sharing a container, clock or SQL server does not require sharing domain models.
Events knows booking users and reservations. Notifications knows recipients,
preferences and inbox items. The composition root connects them through messages,
not through cross-context repository calls.
