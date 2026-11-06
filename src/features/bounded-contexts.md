# Bounded contexts and feature folders

Events and Notifications use different models for different jobs. Events decides
whether someone can reserve seats. Notifications decides whether a recipient
gets an inbox item and who may read it. A bounded context is the boundary within
which a model and its vocabulary apply.

A folder alone does not create that boundary. If Notifications imported the
Events repository to load a user and update a reservation, the models would
still be coupled even with separate folders.

## Organize by capability, then by technical role

Before the feature split, top-level folders such as `domain`, `application` and
`controllers` grouped the code by technical role. With two capabilities, those
folders would mix booking rules with inbox rules.

The folders in `src/features` now group code by capability. Identity handles
accounts and sessions. Events handles bookings. Notifications handles the inbox.
Inside each feature, application code, domain rules and adapters have separate
jobs.

The two trees do not need identical shapes. Events has separate controllers and
presenters. Notifications has a smaller HTTP router calling an application
service. Copying every Events layer into Notifications would add files without
changing which context owns the rules.

## The same person does not require the same entity

Identity's user owns name, email and sessions. Events' user is a separate
booking profile whose primary key references `identity.users.id`. The shared
UUID preserves existing reservations, but Events does not load credentials or
sessions. Identity middleware validates a bearer token and passes the user ID
to the receiving context. Events checks that a booking profile exists;
Notifications resolves its own enrolled recipient.

Notifications' recipient has its own ID, an opaque `bookingUserRef` and an inbox
preference. Alice's seeded booking ID ends in `0001`; her recipient ID ends in
`0101`. The foreign key makes Events depend on Identity's database schema.
They share a database in this lesson. Moving them to separate databases would
require replacing that constraint.

`bookingUserRef` connects the identities without making the recipient an Events
user. Notifications does not need the user's name, email or reservation methods
to manage an in-app inbox. Its repository accepts a string reference, not an
Events `UserId` or entity.

This separation has a cost. A booking user does not automatically become a
recipient. The demo seeds each context independently. If Notifications receives
a fact for an unknown reference, it ignores it rather than fetching the user
from Events. A real enrollment flow would need an explicit contract too.

Do not move `User` into the shared kernel just because both contexts refer to a
person. That would force both models to change together as soon as one needs a
new field or rule.

## Translate at the receiving boundary

Events owns its [published contract](events/contracts/events.ts). Notifications
has one [subscriber adapter](notifications/infrastructure/events-subscriber.ts)
that imports it. The adapter translates the vocabulary before calling the local
application service:

| Events fact            | Notifications input |
| ---------------------- | ------------------- |
| Envelope `messageId`   | `sourceMessageId`   |
| `userId`               | `bookingUserRef`    |
| `reservationId`        | `bookingRef`        |
| `quantity`             | `seats`             |
| `EventReserved`        | `kind: 'confirmed'` |
| `ReservationCancelled` | `kind: 'cancelled'` |

This adapter is an anti-corruption layer. Its job is to keep Events' vocabulary
out of Notifications' application and domain code. It is small because the
contracts have few fields. Notifications still needs the translation to avoid
depending on Events' model.

`NotificationService.receive` accepts a local `BookingNotice`. It knows nothing
about `EventReserved`, the bus or Events' repositories. The adapter logs creation
and update facts but does not turn them into inbox items.

Only published data crosses the boundary. A recipient cannot follow `bookingRef`
through a Notifications repository to retrieve an Events reservation. If an inbox
message later needed an event title, the integration would need to supply that
data in the published contract. Importing the Events repository would let
Notifications depend on Events' internal storage model.

## Separate ownership without separate deployment

All three contexts run in one Bun process and use one PostgreSQL database.
Identity queries `identity.*`, Events' PostgreSQL adapters query `events.*`, and
Notifications queries `notifications.*`. Events' booking-user key references
Identity. Notifications' booking references are text, not foreign keys into Events.

The schemas show table ownership but do not enforce access control. The demo
uses one database role for all three contexts. The composition root imports the
contexts to connect them. Application services do not need those same imports.

There is also no transaction spanning both contexts. Events saves the booking,
then publishes. Notifications handles the fact in a separate transaction. A
notification failure does not undo the booking. The
[event-bus guide](../infrastructure/messaging/event-bus.md) explains the resulting
delivery gaps and why duplicate suppression does not guarantee delivery.

This is a modular application, not a microservices deployment. Separate processes
would add network failures, serialization and deployment concerns. They would
not remove the need to decide who owns each rule.

## Keep the boundary checkable

The [boundary test](../../test/bounded-contexts.test.ts) checks the current
TypeScript import convention. Events must not import Notifications. The only
Notifications file allowed to import Events is the subscriber, and it may import
only the published contract. That contract must not import domain models.

This is a source-text check, not a complete dependency analyzer. It guards the
imports used in this lesson; it does not prove that arbitrary dynamic imports or
SQL joins respect ownership. Review repository SQL and new integration code with
the same rule in mind.

Shared technical types belong in the [shared kernel](../shared-kernel/shared-kernel.md).
Storage clients, DI registrations and the concrete bus belong in infrastructure.
Neither location should become a way to share business models indirectly.
