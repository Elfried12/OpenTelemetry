import type { BucketStrategy, RateLimitDecision } from '../domain/bucket.ts'

export type {
  BucketState,
  BucketStrategy,
  BucketTransition,
  RateLimitDecision,
  RateLimitQuota,
} from '../domain/bucket.ts'

export interface RateLimitRepository {
  /** Read, consume and persist must be atomic for a key and strategy. */
  consume(
    key: string,
    strategy: BucketStrategy,
    now: number,
  ): Promise<RateLimitDecision>
}
