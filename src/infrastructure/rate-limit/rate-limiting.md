# Rate limiting

Rate limiting bounds how many requests a client can make over time. Here it is
HTTP middleware, separate from event capacity rules. A request consumes quota
before reaching its handler, even if the handler later returns an error.

## Default policy

[bootstrap.ts](../../bootstrap.ts) enables a token bucket with capacity 100 and
a refill rate of 100 requests per minute. It starts full and refills
continuously, so a client can make an initial burst of 100 requests. This is
not a strict ceiling of 100 requests in every rolling minute.

Requests from the same validated user share a bucket across sessions.
Anonymous requests share a bucket per socket IP. The middleware covers all
routes, including documentation and notifications. Session validation runs
first, so requests it rejects never reach the limiter or consume quota.

## Choose who shares quota

[rate-limit-middleware.ts](rate-limit-middleware.ts) separates the key strategy
from the bucket algorithm. The key answers which requests share quota:

| Key strategy         | Requests sharing a bucket                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `rateLimitByIp`      | Requests with the same resolved IP.                                                        |
| `rateLimitByUserId`  | Requests with the same validated user ID, falling back to IP for anonymous requests.       |
| `rateLimitBySession` | Requests with the same validated session token, falling back to IP for anonymous requests. |

Session keys contain a SHA-256 hash rather than the bearer token. Missing IPs
share an `unknown` bucket, so a broken IP resolver can make unrelated clients
compete for the same quota.

The default resolver reads the socket address through Bun's `getConnInfo`.
It does not read forwarding headers. Behind a reverse proxy, supply a resolver
that accepts forwarded addresses only from trusted proxies. Trusting arbitrary
client-supplied headers would let callers choose new quota keys.

## Choose how quota recovers

[bucket-strategies.ts](bucket-strategies.ts) provides four algorithms. Factory
arguments are a positive safe-integer capacity and a positive
[Duration](../../shared-kernel/duration.ts) value object. `Duration.create(ms)`
returns a `Result` for untrusted input. `Duration.makeUnsafe(ms)` validates and
throws for invalid configuration. Durations are non-negative whole milliseconds;
bucket periods must be greater than zero.

`Duration.add(other)` and `Duration.subtract(other)` return a `Result` too.
Addition fails on safe-integer overflow; subtraction fails if the result would
be negative, without clamping it to zero. Both leave their operands unchanged.
Use `isLowerThan`, `isHigherThan`, `equals` and `isZero` to compare durations by
value. A timestamp such as `resetAt` is an instant, not a duration.

| Factory                               | Behavior and trade-off                                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixedWindow(limit, window)`          | Counts accepted requests in epoch-aligned windows. Simple, but clients can spend a full quota on both sides of a window boundary.               |
| `slidingWindow(limit, window)`        | Counts accepted timestamps in the preceding window. Avoids the fixed-window boundary burst, but stores up to `limit` timestamps per bucket.     |
| `tokenBucket(capacity, refillPeriod)` | Starts full and refills `capacity` tokens per period, capped at capacity. Allows bursts while limiting the sustained rate.                      |
| `leakyBucket(capacity, drainPeriod)`  | Starts empty, adds one unit per accepted request and drains `capacity` units per period. Rejects overflow. It does not queue or delay requests. |

Each accepted request costs one unit. A rejection does not consume another
unit. Buckets are separate for each combination of key and strategy ID, which
includes the algorithm and its configuration.

The examples below all use a capacity of **3 requests** and a period of
**60 seconds**, with an initially unused bucket. Times are seconds from the
same minute boundary. "Accepted" means admitted by the limiter, even if the
HTTP handler later fails.

### Fixed window: a counter that resets on the clock

`fixedWindow(3, Duration.makeUnsafe(60_000))` divides time into shared intervals
such as `[0, 60)` and `[60, 120)`. Requests in one interval use the same counter.
At the boundary, the entire quota becomes available again.

A client can send 3 requests just before second 60, then another 3 immediately
after second 60. All 6 pass, although they arrive less than a second apart.
The clock boundary matters more than the time between requests.

Use it for coarse per-minute limits where simplicity matters and a boundary
burst is acceptable. It stores one counter and one window start per client.
Avoid it when the requirement is "never more than 3 requests in any 60-second
period."

### Sliding window: look back from each request

`slidingWindow(3, Duration.makeUnsafe(60_000))` asks, on every request:
"How many requests did this client get accepted in the preceding 60 seconds?"
There is no shared reset boundary. The window moves forward with the current
time, and each accepted request occupies a slot for its own 60 seconds.

| Request time | Still-counted earlier requests | Decision                            |
| ------------ | ------------------------------ | ----------------------------------- |
| 0 s          | None                           | Accept request A.                   |
| 10 s         | A                              | Accept request B.                   |
| 20 s         | A, B                           | Accept request C.                   |
| 30 s         | A, B, C                        | Reject. All 3 slots are occupied.   |
| 60 s         | B, C                           | A expires. Accept request D.        |
| 61 s         | B, C, D                        | Reject. B will expire at second 70. |

A request stops counting exactly 60 seconds after it was accepted. At second
60, the client recovers **one slot**, not the whole quota. Rejections do not
extend the window because they are not recorded.

Unlike the fixed window, 3 requests just before second 60 prevent another 3
just after it. Those original requests remain inside the moving window until
roughly second 120.

Use it for rules that need an exact rolling quota, such as limiting login
attempts or expensive exports over the last minute. This implementation keeps
an exact log, not an approximate weighted counter. The trade-off is storing up
to `limit` timestamps per client and filtering them on each request. Large
limits across many clients cost more memory and processing than the other
strategies.

### Token bucket: save credit for bursts

`tokenBucket(3, Duration.makeUnsafe(60_000))` starts with 3 tokens. Each request
spends one token. Time adds tokens continuously at 3 per minute, which is one
token every 20 seconds, up to the capacity of 3.

If the client spends all 3 tokens at second 0, a fourth request is rejected.
At second 20, one token is available and one request can pass. If the client
instead stays idle, the bucket is full again at second 60. Waiting longer
cannot accumulate more than 3 tokens.

Use it for interactive APIs where a short burst is normal, such as a page
loading several resources, but sustained traffic should be bounded. Capacity
controls the saved burst; capacity divided by refill period controls the
sustained rate. This is why it is the bootstrap default.

It does **not** enforce a strict quota of 3 in every rolling minute. For
example, 3 requests at second 0, one at second 20 and one at second 40 all pass.
That is 5 accepted requests inside a 60-second interval.

### Leaky bucket: track debt that drains over time

`leakyBucket(3, Duration.makeUnsafe(60_000))` starts empty. Each accepted
request adds one unit to the bucket. Time drains it continuously at 3 units
per minute. Reject a request if adding it would exceed capacity.

After 3 requests at second 0, the level is 3 and the bucket is full. At second
20, one unit has drained and one more request can fit. If no requests are
accepted after the initial burst, the bucket is empty again at second 60.

Use this version when it is easier to model requests as accumulated debt
rather than available credit. With the same capacity, period and unit request
cost, it admits the same request patterns as the token bucket. They express
the same policy from opposite directions, not different burst guarantees.
Neither one limits the number of requests currently executing.

Some descriptions of a "leaky bucket" mean a queue that releases work at a
steady rate. **That is not this implementation.** This bucket is a policer:
requests pass immediately or receive `429`. It can admit an initial burst of
3; it does not spread those requests over 60 seconds. If a downstream system
must receive evenly spaced work, add a queue and a paced worker instead.

### Which one should I pick?

- Choose **fixed window** for a simple clock-aligned counter if boundary bursts
  are harmless.
- Choose **sliding window** when the rule really means "at most N accepted
  requests over the preceding period."
- Choose **token bucket** for burst-friendly traffic with a bounded sustained
  rate. Keep this default unless the product needs a different guarantee.
- Choose **leaky bucket** for the same burst-and-rate policy expressed as debt
  that drains. Do not choose this implementation expecting queueing or a
  smoother downstream request stream.

## Configure the container

Pass `rateLimitConfig` to [createContainer](../../composition-root.ts). Omit it to
disable limiting. For example, replace the bootstrap policy with a rolling
window and per-session keys:

```ts
import { getConnInfo } from 'hono/bun'
import { Duration } from '#/shared-kernel/duration.ts'
import { slidingWindow } from '#/infrastructure/rate-limit/bucket-strategies.ts'
import { rateLimitBySession } from '#/infrastructure/rate-limit/rate-limit-middleware.ts'

const rateLimitConfig = {
  key: rateLimitBySession((c) => getConnInfo(c).remote.address),
  bucket: slidingWindow(60, Duration.makeUnsafe(60_000)),
}
const container = createContainer({
  applicationSecretKey,
  repository,
  rateLimitConfig,
})
```

This example assumes the secret and event repository are already configured,
as they are in bootstrap. Creating a second session gives a user another
session bucket. Use `rateLimitByUserId` when sessions should share quota.

## HTTP responses

Once a request reaches the limiter, responses carry these headers:

| Header                    | Meaning                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| `X-RateLimit-Limit`       | Configured bucket capacity.                                            |
| `X-RateLimit-Remaining`   | Remaining quota after the decision, rounded down.                      |
| `X-RateLimit-Reset`       | Full quota recovery time, Unix seconds rounded up.                     |
| `X-RateLimit-Reset-After` | Seconds until full quota recovery, rounded up.                         |
| `Retry-After`             | Rejected requests only: seconds until one request can fit, rounded up. |

Reset means the next fixed-window boundary, expiry of the newest accepted
sliding-window request, a full token bucket, or an empty leaky bucket. It assumes
no more requests arrive. `Retry-After` can be shorter than full recovery, since
only one available unit is needed to retry.

When quota is exhausted, the middleware stops before calling the handler and
returns `429` with this JSON body:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests"
  }
}
```

The rejection also includes `Cache-Control: private, no-store` and
`Retry-After`, rounded up to whole seconds with a minimum of one second. A
client should wait before retrying. Other requests sharing its bucket can
consume quota during that wait, so a retry is not guaranteed to succeed.

## Application and domain errors

The [RateLimiter](application/rate-limiter.ts) application service returns a
`Result`. A quota rejection returns the domain error
[RateLimitExceeded](domain/errors.ts), carrying quota metadata and a `Duration`
for retry. The HTTP adapter maps it to `429`, leaving HTTP concerns outside the
domain. Invalid bucket configuration throws `InvalidRateLimitConfiguration` at
startup rather than becoming a request-time quota error.

Repository failures return the application error
[RateLimitUnavailable](application/errors.ts). The HTTP adapter fails closed
with `503` and `RATE_LIMIT_UNAVAILABLE`, without fabricating quota headers or
exposing storage error details.

## Storage and concurrency

The default [InMemoryRateLimitRepository](in-memory-rate-limit-repository.ts)
keeps bucket state in nested maps by policy ID and client key, without JSON
serialization or delimiter-based composite keys. Its read, consume and write steps have no
intervening `await`, so concurrent requests in that process cannot consume the
same available slot. It ignores expired state on access and sweeps expired
entries on traffic at most once per minute. No background timer runs cleanup.

State disappears on restart. Separate API instances have independent quotas.
For a shared limit, pass a repository through `rateLimitConfig.repository` that
implements [RateLimitRepository](ports.ts). Reading, consuming and persisting
state must be atomic for a key and strategy. Separate remote reads and writes
would let concurrent requests spend the same quota.

## Test without waiting

The container's injected clock also drives rate limiting. Tests can advance
time to check expiration, refill and retry behavior without real-time sleeps.
See [rate-limit.test.ts](../../../test/rate-limit.test.ts).

Run the focused tests with:

```sh
bun test ./test/rate-limit.test.ts
```
