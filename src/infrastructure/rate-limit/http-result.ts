import type { Context } from 'hono'
import { Duration } from '#/shared-kernel/duration.ts'
import { HttpStatusCode } from '#/infrastructure/http/http-code.ts'
import type { RateLimitQuota } from './domain/bucket.ts'
import { RateLimitExceeded } from './domain/errors.ts'
import type { RateLimitUnavailable } from './application/errors.ts'

export function quotaHeaders(
  c: Context,
  quota: RateLimitQuota,
  now: number,
): void {
  const resetAfter = Duration.makeUnsafe(
    Math.max(0, Math.ceil(quota.resetAt - now)),
  )
  c.header('X-RateLimit-Limit', String(quota.limit))
  c.header('X-RateLimit-Remaining', String(quota.remaining))
  c.header('X-RateLimit-Reset', String(Math.ceil(quota.resetAt / 1000)))
  c.header('X-RateLimit-Reset-After', String(resetAfter.toWholeSeconds()))
}

export function httpFailure(
  c: Context,
  error: RateLimitExceeded | RateLimitUnavailable,
  now: number,
) {
  c.header('Cache-Control', 'private, no-store')
  if (error instanceof RateLimitExceeded) {
    quotaHeaders(c, error.quota, now)
    c.header('Retry-After', String(error.retryAfter.toWholeSeconds()))
    return c.json(
      { error: { code: 'RATE_LIMIT_EXCEEDED', message: error.message } },
      HttpStatusCode.TooManyRequests,
    )
  }
  return c.json(
    { error: { code: 'RATE_LIMIT_UNAVAILABLE', message: error.message } },
    HttpStatusCode.ServiceUnavailable,
  )
}
