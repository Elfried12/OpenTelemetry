import { Option } from '#/shared-kernel/option.ts'
import type {
  BucketState,
  BucketStrategy,
  RateLimitRepository,
} from './ports.ts'

interface StoredBucket {
  state: BucketState
  expiresAt: number
}

export class InMemoryRateLimitRepository implements RateLimitRepository {
  private readonly policies = new Map<string, Map<string, StoredBucket>>()
  private nextSweepAt = 0

  async consume(key: string, strategy: BucketStrategy, now: number) {
    // No await between read and write: consumption is atomic within this process.
    if (now >= this.nextSweepAt) {
      this.prune(now)
      this.nextSweepAt = now + 60_000
    }
    const buckets = Option.match(
      Option.fromNullable(this.policies.get(strategy.id)),
      {
        onNone: () => {
          const entries = new Map<string, StoredBucket>()
          this.policies.set(strategy.id, entries)
          return entries
        },
        onSome: (entries) => entries,
      },
    )
    const state = Option.match(Option.fromNullable(buckets.get(key)), {
      onNone: () => Option.none<BucketState>(),
      onSome: (bucket) => {
        if (bucket.expiresAt <= now) {
          return Option.none<BucketState>()
        }
        return Option.some(bucket.state)
      },
    })
    const transition = strategy.consume(state, now)
    buckets.set(key, {
      state: transition.state,
      expiresAt: transition.expiresAt,
    })
    return transition.decision
  }

  /** Sweeps on traffic, including expired keys that are never requested again. */
  prune(now: number): void {
    for (const [policyId, buckets] of this.policies) {
      for (const [key, bucket] of buckets) {
        if (bucket.expiresAt <= now) {
          buckets.delete(key)
        }
      }
      if (buckets.size === 0) {
        this.policies.delete(policyId)
      }
    }
  }
}
