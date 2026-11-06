import { Option } from '#/shared-kernel/option.ts'
import type {
  BucketState,
  BucketStrategy,
  RateLimitRepository,
} from '../application/ports.ts'
import { ExpirationHeap } from './expiration-heap.ts'

interface StoredBucket {
  readonly policyId: string
  readonly key: string
  state: BucketState
  expiresAt: number
}

export class InMemoryRateLimitRepository implements RateLimitRepository {
  private readonly policies = new Map<string, Map<string, StoredBucket>>()
  private readonly expirations = new ExpirationHeap<StoredBucket>()

  async consume(key: string, strategy: BucketStrategy, now: number) {
    // No await between read and write: consumption is atomic within this process.
    // Peeking at the earliest deadline is O(1) when nothing has expired.
    this.prune(now)
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
    const stored = buckets.get(key)
    const state = stored
      ? Option.some(stored.state)
      : Option.none<BucketState>()
    const transition = strategy.consume(state, now)
    const bucket: StoredBucket = stored ?? {
      policyId: strategy.id,
      key,
      ...transition,
    }
    bucket.state = transition.state
    bucket.expiresAt = transition.expiresAt
    buckets.set(key, bucket)
    this.expirations.set(bucket, bucket.expiresAt)
    return transition.decision
  }

  /** Remove only expired buckets, including clients that never return. */
  prune(now: number): void {
    let expired = this.expirations.popExpired(now)
    while (expired) {
      const buckets = this.policies.get(expired.policyId)
      if (buckets) {
        buckets.delete(expired.key)
        if (buckets.size === 0) {
          this.policies.delete(expired.policyId)
        }
      }
      expired = this.expirations.popExpired(now)
    }
  }
}
