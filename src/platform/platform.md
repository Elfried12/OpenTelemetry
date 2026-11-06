# Shared technical modules

`features/` contains business capabilities such as bookings, identity and inbox
notifications. `platform/` contains technical modules used to run those features:
HTTP helpers, dependency injection, messaging and rate limiting.

The top-level folder names identify ownership, not architectural layers.
`infrastructure/` belongs inside a module when it contains concrete adapters.
Putting a whole module beneath a top-level `infrastructure/` would make its own
application and domain layers appear to belong to an adapter layer.

## Rate limiting

Rate limiting has enough behavior to separate its responsibilities:

```text
rate-limit/
  domain/
    bucket.ts                          State, transitions and strategy interface
    bucket-strategies.ts               Fixed, sliding, token and leaky policies
    timestamp-queue.ts                  Immutable FIFO for sliding timestamps
    errors.ts                          Quota rejection and invalid configuration
  application/
    rate-limiter.ts                    Clock, atomic storage and Result mapping
    ports.ts                           Atomic consumption repository interface
    errors.ts                          Storage unavailability
  infrastructure/
    in-memory-rate-limit-repository.ts  Owns the latest bucket state
    expiration-heap.ts                 Indexed expiration scheduling
  http/
    rate-limit-middleware.ts           Client keys and request interception
    http-result.ts                     Status codes and quota headers
```

Here, domain means the limiter's model and policies. It does not make rate
limiting a booking rule or a separate business bounded context.

Domain code depends only on its own model and the shared kernel. Application
code depends on that domain and declares the repository interface it needs.
The in-memory adapter implements that interface. The HTTP adapter calls the
application and translates its results. It also selects the in-memory default
when no repository is supplied, preserving the existing middleware interface.
The [composition root](../composition-root.ts) supplies runtime configuration.

The queue belongs with the domain because it represents the exact rolling log
used by the policy. The heap belongs with the storage adapter because expiration
scheduling is an in-memory storage concern. Neither structure needs to become
a shared-kernel abstraction just because another module might use it someday.

See [rate limiting](rate-limit/rate-limiting.md) for policy examples, complexity
trade-offs and concurrency requirements.

## Keep smaller modules small

`di/`, `http/` and `messaging/` do not need empty domain and application folders.
Group code when responsibilities differ, rather than copying the rate limiter's
tree everywhere. The DI token registry refers to concrete application types as
part of composition; this is not a claim that every file under `platform/` is
independent of business features.

Business-specific database adapters stay in their owning feature's
`infrastructure/`. Moving them into `platform/` would hide which feature owns
the persistence model.
