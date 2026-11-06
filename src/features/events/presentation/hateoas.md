# HATEOAS and action links

HATEOAS means Hypermedia as the Engine of Application State. A response includes
links that tell a client where it can go next and which actions it can attempt.
Instead of constructing every URL itself, a client can follow a named relation
such as `reserve` or `cancel` using the supplied HTTP method.

## A resource adds navigation to a DTO

[resources.ts](resources.ts) wraps the output of the existing
[DTO presenters](dto-and-presenter.md) with `_links`. An event still has its
usual fields, but it also carries relations such as `self`, `collection` and
`update`.

The shared [link schema](../../../platform/http/hypermedia.ts) describes
our small `application/json` convention. Each link contains a relative `href`
and a `method`. This is not HAL, and a link does not describe the request body.
Clients still need the [OpenAPI contract](../../../platform/http/openapi.md)
to know what to send.

Links belong to HTTP presentation. The domain should not know route names or
HTTP methods, and the same domain object can have a different representation
for another transport. Collections remain arrays of individual resources here;
there is no collection wrapper or pagination navigation.

## Available actions depend on current state

The presenters select links rather than returning a fixed list of endpoints:

- An event advertises `update` only while its start time is in the future.
- An upcoming event can advertise `reserve` for a known viewer.
- A reservation advertises `cancel` only while it has no cancellation date.
  The cancellation response therefore drops that link.

`presentEventResource` receives `now` explicitly. It does not read the system
clock itself, so the caller and tests can choose the instant used to decide
whether the event has started.

A client can use the presence of a relation to decide whether to display an
action. It should not infer all business rules from the links. For example,
the event presenter does not query remaining capacity before adding `reserve`.

## A link is an invitation, not a guarantee

The response describes a snapshot. By the time a client follows a link, an
event may have started or another reservation may have used the remaining
seats. The command must still check its rules and can return an error.

Removing a link is not enforcement either. A client can construct the URL
without reading the response. Controllers and domain operations remain
responsible for rejecting invalid requests.

[hypermedia.test.ts](../../../../test/hypermedia.test.ts) checks the changing
link sets and follows the advertised update, reservation and cancellation
links through HTTP requests.
