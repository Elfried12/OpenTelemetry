import type { Duration } from '#/shared-kernel/duration.ts'
import type { Option } from '#/shared-kernel/option.ts'

export type BucketState =
  | { kind: 'fixed-window'; start: number; count: number }
  | { kind: 'sliding-window'; timestamps: number[] }
  | { kind: 'token-bucket'; updatedAt: number; tokens: number }
  | { kind: 'leaky-bucket'; updatedAt: number; level: number }


export interface RateLimitQuota {
  limit: number
  remaining: number
  /** Unix milliseconds when the quota fully recovers if no more requests arrive. */
  resetAt: number
}

export interface RateLimitDecision extends RateLimitQuota {
  allowed: boolean
  /** Time until one request can be accepted; zero for an accepted request. */
  retryAfter: Duration
}

// type RateLimitQuota2 = {
//   limit: number
//   remaining: number
//   /** Unix milliseconds when the quota fully recovers if no more requests arrive. */
//   resetAt: number
// }
//
// type RateLimitDecision2 = RateLimitQuota2 & {
//   allowed: boolean
//   /** Time until one request can be accepted; zero for an accepted request. */
//   retryAfter: Duration
//
// }

export interface BucketTransition {
  state: BucketState
  expiresAt: number
  decision: RateLimitDecision
}

export interface BucketStrategy {
  /** Includes algorithm and parameters, so different policies never share state. */
  readonly id: string
  /** Pure transition. Timestamps are Unix milliseconds. */
  consume(state: Option<BucketState>, now: number): BucketTransition
}
