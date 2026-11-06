# OpenAPI and route documentation

OpenAPI describes an HTTP API in a machine-readable format. In this project,
`/openapi.json` returns the OpenAPI 3.1 document. `/docs` loads Scalar, which
reads that document to display operations and let a reader try requests.
Scalar is the UI, not a separate source of API definitions.

## Living documentation

Cyrille Martraire's book _Living Documentation: Continuous Knowledge Sharing by
Design_ describes ways to make knowledge part of everyday development rather
than leaving it in documents that drift away from the software.

Our OpenAPI setup applies that idea in a small way. Route metadata lives beside
the handlers, Valibot schemas supply the documented data shapes, and tests check
the published examples. Changing a shared schema changes the generated contract
without requiring someone to redraw it in a separate API editor.

Generation alone does not make documentation accurate. Summaries, business-rule
descriptions and example values still need review when behavior changes. Tests
catch some mismatches, but they do not prove that every documented response
matches every possible execution of a handler. The handwritten notes explain
why the code works this way; the generated document describes the HTTP contract.

## Keep the contract beside the handler

Route files such as [event-routes.ts](../../features/events/routes/event-routes.ts)
place `documentRoute` before each handler. The metadata describes the operation's
parameters, request body, responses and examples. Keeping it beside the handler
makes discrepancies easier to spot when a route changes.

[openapi.ts](openapi.ts) provides helpers shared by the route files:

- `documentRoute` assigns a feature tag and adds common JSON error responses.
  Every documented operation gets a `500` response. Operation-specific
  responses can override the shared definitions.
- `jsonBody`, `jsonResponse` and `jsonResponseExamples` attach a Valibot schema
  and examples to the `application/json` media type. Named examples can show
  different representations of the same resource, such as an upcoming event
  and a started event with fewer action links.
- `parameter` describes a path, query or header parameter. Path parameters are
  always required. Other parameters are optional when their schema accepts
  `undefined`.

`documentationRoutes` installs the generated document and Scalar on the Hono
app. The generator reads registered route metadata, including feature routes
mounted after the documentation handler was registered. The document excludes
`/openapi.json` and `/docs` themselves.

## Document JSON, not internal TypeScript values

Request validation can transform a JSON date string into a `Date` or an ID
string into a branded type. Neither transformation changes what a client sends
over HTTP.

The helpers type examples with `v.InferInput<Schema>` so examples describe the
JSON before those transformations. The parameter helper also converts schemas
with `typeMode: 'input'`. Body and response helpers use `resolver` from
`hono-openapi` to produce schemas from Valibot rather than maintaining a second
handwritten schema.

OpenAPI 3.1 accepts JSON Schema. That is why the parameter helper can use the
Valibot JSON Schema converter. Its type assertion bridges the narrower OpenAPI
types used by the dependency. It does not validate the generated schema.

## Describing a rule does not enforce it

`documentRoute` describes a handler. It does not replace request parsing or the
application and domain checks. Adding a documented error response does not make
a handler return that error.

JSON Schema captures shapes and constraints such as required fields, date-time
strings and positive integer capacity. The API also has rules that these
generated schemas do not express, such as requiring a future start date or
rejecting an empty event patch. Route descriptions explain those rules, while
runtime validation enforces them.

Examples have a similar limit. Type checking catches incompatible TypeScript
shapes, but it does not prove that an example satisfies every Valibot constraint.
[openapi.test.ts](../../../test/openapi.test.ts) parses published examples with
their Valibot schemas. It also checks operation metadata, generated constraints
and the documentation endpoints. When changing a contract, update its examples
and run that test.

For the response links described by these schemas, see
[HATEOAS and action links](../../features/events/presentation/hateoas.md).
