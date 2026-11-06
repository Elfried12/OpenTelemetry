import type { Duration } from '#/shared-kernel/duration.ts'
import type { RateLimitQuota } from './bucket.ts'

export class InvalidRateLimitConfiguration extends Error {}

export class RateLimitExceeded extends Error {
  constructor(
    readonly quota: RateLimitQuota,
    readonly retryAfter: Duration,
  ) {
    super('Too many requests')
    this.name = 'RateLimitExceeded'
  }
}
