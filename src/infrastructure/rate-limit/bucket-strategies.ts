import { Duration } from '#/shared-kernel/duration.ts'
import { Option } from '#/shared-kernel/option.ts'
import { InvalidRateLimitConfiguration } from './domain/errors.ts'
import type { BucketStrategy, RateLimitDecision } from './domain/bucket.ts'

function validate(limit: number, period: Duration) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new InvalidRateLimitConfiguration(
      'Rate limit capacity must be a positive safe integer',
    )
  }
  if (period.isZero()) {
    throw new InvalidRateLimitConfiguration(
      'Rate limit period must be greater than zero',
    )
  }
}

function decision(
  allowed: boolean,
  limit: number,
  remaining: number,
  wait: number,
  resetAt: number,
): RateLimitDecision {
  let retryAfter = Duration.zero
  if (!allowed) {
    // Remove floating-point noise at exact millisecond boundaries.
    retryAfter = Duration.makeUnsafe(Math.max(1, Math.ceil(wait - 1e-9)))
  }
  return {
    allowed,
    limit,
    remaining: Math.max(0, Math.floor(remaining)),
    retryAfter,
    resetAt,
  }
}

/** Epoch-aligned windows. Allows bursts on either side of a window boundary. */
export function fixedWindow(limit: number, window: Duration): BucketStrategy {
  validate(limit, window)
  const windowMs = window.milliseconds
  return {
    id: `fixed-window:${limit}:${windowMs}`,
    consume(state, now) {
      const start = Math.floor(now / windowMs) * windowMs
      const count = Option.match(state, {
        onNone: () => 0,
        onSome: (previous) => {
          if (previous.kind === 'fixed-window' && previous.start === start) {
            return previous.count
          }
          return 0
        },
      })
      const allowed = count < limit
      const nextCount = count + Number(allowed)
      const resetAt = start + windowMs
      return {
        state: { kind: 'fixed-window', start, count: nextCount },
        expiresAt: resetAt,
        decision: decision(
          allowed,
          limit,
          limit - nextCount,
          resetAt - now,
          resetAt,
        ),
      }
    },
  }
}

/** Exact rolling window log. Stores at most `limit` accepted timestamps. */
export function slidingWindow(limit: number, window: Duration): BucketStrategy {
  validate(limit, window)
  const windowMs = window.milliseconds
  return {
    id: `sliding-window:${limit}:${windowMs}`,
    consume(state, now) {
      const timestamps = Option.match(state, {
        onNone: () => [],
        onSome: (previous) => {
          if (previous.kind === 'sliding-window') {
            return previous.timestamps.filter((time) => time > now - windowMs)
          }
          return []
        },
      })
      const allowed = timestamps.length < limit
      if (allowed) {
        timestamps.push(now)
      }
      const oldest = Option.match(Option.fromNullable(timestamps[0]), {
        onNone: () => now,
        onSome: (time) => time,
      })
      const newest = Option.match(Option.fromNullable(timestamps.at(-1)), {
        onNone: () => now,
        onSome: (time) => time,
      })
      const resetAt = newest + windowMs
      return {
        state: { kind: 'sliding-window', timestamps },
        expiresAt: resetAt,
        decision: decision(
          allowed,
          limit,
          limit - timestamps.length,
          oldest + windowMs - now,
          resetAt,
        ),
      }
    },
  }
}

/** Starts full and continuously refills `capacity` tokens per refill period. */
export function tokenBucket(
  capacity: number,
  refillPeriod: Duration,
): BucketStrategy {
  validate(capacity, refillPeriod)
  const rate = capacity / refillPeriod.milliseconds
  return {
    id: `token-bucket:${capacity}:${refillPeriod.milliseconds}`,
    consume(state, now) {
      const initial = { updatedAt: now, tokens: capacity }
      const previous = Option.match(state, {
        onNone: () => initial,
        onSome: (value) => {
          if (value.kind === 'token-bucket') {
            return value
          }
          return initial
        },
      })
      const updatedAt = Math.max(now, previous.updatedAt)
      const available = Math.min(
        capacity,
        previous.tokens + (updatedAt - previous.updatedAt) * rate,
      )
      const allowed = available >= 1 - Number.EPSILON * 4
      const tokens = Math.max(0, available - Number(allowed))
      const resetAt = updatedAt + (capacity - tokens) / rate
      return {
        state: { kind: 'token-bucket', updatedAt, tokens },
        expiresAt: resetAt,
        decision: decision(
          allowed,
          capacity,
          tokens,
          (1 - tokens) / rate,
          resetAt,
        ),
      }
    },
  }
}

/** A policing bucket, not a request queue. Drains `capacity` units per period. */
export function leakyBucket(
  capacity: number,
  drainPeriod: Duration,
): BucketStrategy {
  validate(capacity, drainPeriod)
  const rate = capacity / drainPeriod.milliseconds
  return {
    id: `leaky-bucket:${capacity}:${drainPeriod.milliseconds}`,
    consume(state, now) {
      const initial = { updatedAt: now, level: 0 }
      const previous = Option.match(state, {
        onNone: () => initial,
        onSome: (value) => {
          if (value.kind === 'leaky-bucket') {
            return value
          }
          return initial
        },
      })
      const updatedAt = Math.max(now, previous.updatedAt)
      const drained = Math.max(
        0,
        previous.level - (updatedAt - previous.updatedAt) * rate,
      )
      const allowed = drained + 1 <= capacity + Number.EPSILON * 4
      const level = Math.min(capacity, drained + Number(allowed))
      const resetAt = updatedAt + level / rate
      return {
        state: { kind: 'leaky-bucket', updatedAt, level },
        expiresAt: resetAt,
        decision: decision(
          allowed,
          capacity,
          capacity - level,
          (level + 1 - capacity) / rate,
          resetAt,
        ),
      }
    },
  }
}
