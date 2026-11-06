# Shared kernel

This directory contains small types that several layers need without depending
on HTTP, persistence or a specific business operation.

[Result](result.ts) models success or failure. [Option](option.ts) models presence
or absence. Domain rules, application handlers and infrastructure adapters use
the same definitions, so they do not need translations between competing
representations at every call.

[CommandHandler](command-handler.ts) and [QueryHandler](query-handler.ts) define
`execute(command): Promise<Result>` and `execute(query): Promise<Result>`.
Application command and query use cases implement these contracts. Here `Result`
is a generic return type, not necessarily the shared `Result` union. A query can
return an array, while a command can return a success-or-failure value.

[EventBus](event-bus.ts) defines publication and subscription without choosing a
transport. [EventEnvelope](event-envelope.ts) adds message identity, time and
version to a generic event value. Neither names Events or Notifications. The
concrete [in-memory bus](../platform/messaging/in-memory-event-bus.ts)
belongs in infrastructure, where its listener and failure policies can change
without putting those choices in every publisher.

## Why keep it separate

Putting `Result` in a controller module would force domain code to import from
the HTTP layer. Putting it inside a repository adapter would make application
code depend on infrastructure. A separate module avoids both dependencies.

The dependency direction is one way. Other layers may import the shared kernel;
the shared kernel must not import handlers, controllers or database clients.

## Keep the boundary small

Shared does not mean "anything used twice". Capacity belongs to the event
[Events domain](../features/events/domain/domain.md), and Events response DTOs belong to
[presentation](../features/events/presentation/dto-and-presenter.md). Neither belongs here just
because several files use it.

In domain-driven design, a shared kernel can also mean a jointly maintained
subset of business models shared by bounded contexts. This directory uses the
name for common technical types instead. Events and Notifications do not share a
user entity or reservation model. Events owns its published facts in
[its contract](../features/events/contracts/events.ts), not here.

Sharing `Result` or an envelope is a smaller commitment than sharing a business
model. A shared `User` would make recipient preferences and booking identity part
of the same change contract. The [bounded-context guide](../features/bounded-contexts.md)
explains why this lesson keeps them separate.

See [errors as values](errors-as-values.md) for the conventions around `Result`,
exceptions and missing records.
