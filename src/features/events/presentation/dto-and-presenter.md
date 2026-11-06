# DTOs and presenters

A DTO, or data transfer object, describes data sent across a boundary. It has no
business methods. A presenter converts an internal object to that public shape.

[dtos.ts](dtos.ts) defines response schemas with Valibot and derives TypeScript
types from them. [event-presenter.ts](event-presenter.ts) constructs and validates
the response objects.

## The representations have different jobs

An event crosses several representations:

| Representation         | Start time               | Capacity                | Purpose                         |
| ---------------------- | ------------------------ | ----------------------- | ------------------------------- |
| Domain `Event`         | `Date` in `startsAt`     | `Capacity` value object | Enforce business rules          |
| Database `EventEntity` | `Date` in `starts_at`    | `number`                | Match the persisted row         |
| Response `EventDto`    | ISO string in `startsAt` | `number`                | Define the public JSON contract |

The presenter calls `toISOString()` and extracts `capacity.value`. Reservation
responses convert `Option<Date>` to an ISO string or `null`. These choices belong
to the response contract, not to the entity's booking rules.

Returning `event.data` directly would leak domain representation changes into
the API. Returning a database row would also expose storage naming and make API
changes depend on table layout.

## Input and output validation

[validation.ts](../validation.ts) validates request shapes and converts IDs and
dates before a controller calls the application. Domain factories still validate
their own rules because HTTP is not the only possible caller.

Output schemas check what our own presenters produce. If a presenter violates
its schema, `v.parse` throws. That is a programming or data-integrity problem,
not an expected invalid request.

[application-error.ts](application-error.ts) chooses the public status and error
body for expected application failures. The
[controller](../controllers/controller.md) sends the response. Neither presenter
queries the repository or decides whether seats can be reserved.

## HTTP resources add links

[resources.ts](resources.ts) adds `_links` to the DTOs for HTTP responses.
The DTO presenters still handle data conversion; resource presenters choose
navigation and action links from the current state. See
[HATEOAS and action links](hateoas.md) for the conventions and their limits.
