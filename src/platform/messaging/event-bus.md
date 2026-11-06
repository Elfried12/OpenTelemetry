# Events and the in-memory bus

A command asks the application to do something. An event reports something that
has happened. `ReserveEventCommand` can fail because an event has no seats left.
`EventReserved` describes a reservation that Events has already saved.

This distinction changes who makes the decision. Notifications may ignore a
reservation fact because the recipient opted out. It cannot reject the booking.
If sending a notification were a condition of accepting a booking, this flow
would not enforce that rule.

## Follow one reservation

The [reservation handler](../../features/events/application/commands/reserve-event.ts)
first asks the repository to perform a protected mutation. Inside its callback,
it checks availability and constructs a reservation. Only after the repository
returns a successful result does the handler publish `EventReserved`.

```text
ReserveEventUseCase.execute
  -> repository.reserve
       -> check availability and construct the reservation
       -> commit the write
  -> eventBus.publish
       -> Notifications subscriber
       -> NotificationService.receive
  -> return the saved reservation
```

The callback may run again when a Valkey write encounters contention. Publishing
inside it could announce a reservation from an attempt that never commits, or
announce the same booking several times. Publication belongs after the repository
operation, not inside the retryable callback.

Failed commands and queries publish nothing. The application publishes facts;
domain entities do not need a bus dependency to enforce their rules.

## A fact and its envelope have different jobs

The [Events contract](../../features/events/contracts/events.ts) names the fact
and its business data. It exports `EventCreated`, `EventUpdated`, `EventReserved`
and `ReservationCancelled`. Despite the union's name, `DomainEvent`, this is a
published contract. It uses plain string references rather than exporting Events'
branded identifiers or entity classes.

The shared [envelope](../../shared-kernel/event-envelope.ts) adds delivery metadata:

```ts
{
  messageId: '01900000-0000-7000-8000-000000000099',
  occurredAt: new Date('2030-01-01T00:00:00Z'),
  version: 1,
  event: {
    _tag: 'EventReserved',
    content: {
      reservationId: '01900000-0000-7000-8000-000000000010',
      eventId: '01900000-0000-7000-8000-000000000004',
      userId: '01900000-0000-7000-8000-000000000001',
      quantity: 2,
    },
  },
}
```

The reservation ID identifies the booking. The message ID identifies this
occurrence. A later cancellation refers to the same reservation with a new
message ID. To retry delivery of an existing fact, preserve its message ID.
Generating a new one defeats the consumer's duplicate check.

Commands obtain IDs and time from injected dependencies. The envelope timestamp
is the publication-time reading after persistence, not a database commit timestamp.
`version: 1` labels the current contract; the bus does not validate versions or
convert old messages. These are in-process TypeScript values, including `Date`
objects. A network transport would also need serialization and runtime validation.

## The port does not promise durable delivery

[EventBus](../../shared-kernel/event-bus.ts) defines `publish` and `subscribe`.
Subscriptions name an event's `_tag`. The listener receives an envelope whose
payload is narrowed to that member of the event union:

```ts
bus.subscribe('EventReserved', (envelope) => {
  console.log(envelope.event.content.quantity)
})
```

Unknown tags fail type checking. Delivery metadata remains on the envelope;
subscribers receive the original envelope, not a reconstructed payload.

[InMemoryEventBus](in-memory-event-bus.ts) supplies their execution policy:

- Each publication snapshots only the listeners registered for its event's tag. A subscription change affects
  later publications, not the snapshot already running.
- It starts listeners concurrently and waits for them all. Do not rely on one
  listener finishing before another.
- It logs thrown errors and rejected promises without rejecting publication.
- Unsubscribing is safe to repeat. It does not cancel a listener already running.

Awaiting publication is not background processing. A slow Notifications write
still delays the reservation response. Failure isolation means a failed listener
does not fail the committed booking; it does not mean the listener will run again.
There is no queue, replay store, timeout or automatic retry in this adapter.

The [composition root](../../composition-root.ts) installs Notifications once
per container, even when a test resolves a command without resolving the HTTP app.
See [dependency injection](../../features/events/application/dependency-injection.md)
for subscription lifetime and shutdown ownership.

## Duplicate suppression cannot recover a missing message

Notifications translates reservation facts into its own `BookingNotice` and
records the source message ID atomically with an inbox item. Repeated delivery
of that ID cannot add a second item. An enrolled recipient's opt-out also records
the message as processed. Unknown recipients are ignored without enrollment or a
processed-message record.

There are still gaps between the booking and notification transactions:

| Failure                                                | Outcome with this adapter                                         |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| Booking mutation fails                                 | No fact is published.                                             |
| Process stops after booking commit, before publication | The booking survives; the notification can be lost.               |
| Notifications throws while handling the fact           | The bus logs the failure; the booking succeeds; no retry follows. |
| The same envelope reaches Notifications again          | Its repository suppresses a duplicate for the enrolled recipient. |

An outbox would save the booking and its outgoing fact in one transaction. A
separate publisher could then retry delivery. That would address the commit-to-
publication gap, but consumers would still need duplicate suppression when a
publisher retries after an uncertain acknowledgement. Replacing this class with
a broker client alone would not close that gap.

The [bus tests](../../../test/in-memory-event-bus.test.ts) cover listener behavior.
The [application event tests](../../../test/application/domain-events.test.ts)
cover publication after successful commands. The
[application-service guide](../../features/notifications/application/application-service.md)
explains the consumer's transaction boundary.
