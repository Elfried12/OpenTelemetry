import { Result } from '#/shared-kernel/result.ts'
import type { BucketStrategy, RateLimitQuota } from '../domain/bucket.ts'
import { RateLimitExceeded } from '../domain/errors.ts'
import type { RateLimitRepository } from '../ports.ts'
import { RateLimitUnavailable } from './errors.ts'

export class RateLimiter {
  constructor(
    private readonly repository: RateLimitRepository,
    private readonly bucket: BucketStrategy,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async consume(
    key: string,
  ): Promise<Result<RateLimitQuota, RateLimitExceeded | RateLimitUnavailable>> {
    const consumed = await Result.tryPromise(
      () => this.repository.consume(key, this.bucket, this.now().getTime()),
      (cause) => new RateLimitUnavailable(cause),
    )
    if (Result.isFailure(consumed)) {
      return consumed
    }
    const decision = consumed.value
    const quota: RateLimitQuota = {
      limit: decision.limit,
      remaining: decision.remaining,
      resetAt: decision.resetAt,
    }
    if (!decision.allowed) {
      return Result.fail(new RateLimitExceeded(quota, decision.retryAfter))
    }
    return Result.succeed(quota)
  }
}
