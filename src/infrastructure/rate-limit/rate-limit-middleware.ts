import { createHash } from 'node:crypto'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import { RateLimiter } from './application/rate-limiter.ts'
import { httpFailure, quotaHeaders } from './http-result.ts'
import type { BucketStrategy, RateLimitRepository } from './ports.ts'
import { InMemoryRateLimitRepository } from './in-memory-rate-limit-repository.ts'

export type IpResolver = (context: Context) => string | undefined
export type RateLimitKeyStrategy = (context: Context) => string

export function rateLimitByIp(resolveIp: IpResolver): RateLimitKeyStrategy {
  return (c) => {
    // Never trust forwarding headers by default. Missing IPs share one bucket.
    return `ip:${resolveIp(c) || 'unknown'}`
  }
}

export function rateLimitByUserId(resolveIp: IpResolver): RateLimitKeyStrategy {
  const byIp = rateLimitByIp(resolveIp)
  return (c) => {
    return Option.match(Option.fromNullable(c.get('identityUserId')), {
      onNone: () => byIp(c),
      onSome: (userId) => `user:${userId}`,
    })
  }
}

export function rateLimitBySession(
  resolveIp: IpResolver,
): RateLimitKeyStrategy {
  const byIp = rateLimitByIp(resolveIp)
  return (c) => {
    // Keep bearer credentials out of repository keys.
    return Option.match(Option.fromNullable(c.get('sessionToken')), {
      onNone: () => byIp(c),
      onSome: (token) => {
        const tokenHash = createHash('sha256').update(token).digest('hex')
        return `session:${tokenHash}`
      },
    })
  }
}

export interface RateLimitConfig {
  key: RateLimitKeyStrategy
  bucket: BucketStrategy
  repository?: RateLimitRepository
}

export function rateLimitMiddleware(
  config: RateLimitConfig,
  now: () => Date = () => new Date(),
) {
  const repository = config.repository ?? new InMemoryRateLimitRepository()
  return createMiddleware(async (c, next) => {
    // Use one instant for both consumption and relative reset headers.
    const timestamp = now()
    const key = config.key(c)
    const limiter = new RateLimiter(repository, config.bucket, () => timestamp)
    const result = await limiter.consume(key)
    const timestampMs = timestamp.getTime()
    if (Result.isFailure(result)) {
      return httpFailure(c, result.error, timestampMs)
    }
    quotaHeaders(c, result.value, timestampMs)
    await next()
  })
}
