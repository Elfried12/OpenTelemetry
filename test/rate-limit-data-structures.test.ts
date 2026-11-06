import { expect, test } from 'bun:test'
import { TimestampQueue } from '#/platform/rate-limit/domain/timestamp-queue.ts'
import { ExpirationHeap } from '#/platform/rate-limit/infrastructure/expiration-heap.ts'
import { slidingWindow } from '#/platform/rate-limit/domain/bucket-strategies.ts'
import { InMemoryRateLimitRepository } from '#/platform/rate-limit/infrastructure/in-memory-rate-limit-repository.ts'
import { Duration } from '#/shared-kernel/duration.ts'
import { Option } from '#/shared-kernel/option.ts'

test('timestamp queue preserves old versions across enqueue, reversal and expiration', () => {
  const empty = TimestampQueue.empty()
  const original = empty.enqueue(0).enqueue(10).enqueue(20)
  const expired = original.expireThrough(10)
  expect(empty.size).toBe(0)
  expect(original.size).toBe(3)
  expect(original.oldest).toBe(0)
  expect(original.newest).toBe(20)
  expect(expired.size).toBe(1)
  expect(expired.oldest).toBe(20)
  const drained = expired.dequeue()
  expect(drained.size).toBe(0)
  expect(drained.oldest).toBeUndefined()
  expect(drained.newest).toBeUndefined()
  expect(drained.dequeue()).toBe(drained)
  expect(drained.enqueue(30).oldest).toBe(30)
})

test('queue matches an array through repeated partial drains and refills', () => {
  let queue = TimestampQueue.empty()
  let reference: number[] = []
  for (let now = 0; now < 10_000; now++) {
    reference = reference.filter((value) => value > now - 37)
    queue = queue.expireThrough(now - 37)
    if (now % 3 !== 0) {
      reference.push(now)
      queue = queue.enqueue(now)
    }
    expect(queue.size).toBe(reference.length)
    expect(queue.oldest).toBe(reference[0])
    expect(queue.newest).toBe(reference.at(-1))
  }
})

test('indexed heap repairs deadlines in both directions and retains one entry per key', () => {
  const heap = new ExpirationHeap<string>()
  heap.set('a', 10)
  heap.set('b', 20)
  heap.set('c', 30)
  heap.set('a', 40)
  heap.set('c', 5)
  expect(heap.size).toBe(3)
  expect(heap.popExpired(4)).toBeUndefined()
  expect(heap.popExpired(5)).toBe('c')
  expect(heap.popExpired(20)).toBe('b')
  expect(heap.popExpired(39)).toBeUndefined()
  expect(heap.popExpired(40)).toBe('a')
  expect(heap.size).toBe(0)
  expect(heap.popExpired(Infinity)).toBeUndefined()
  heap.set('a', 0)
  expect(heap.popExpired(0)).toBe('a')
})

test('heap agrees with a sorted reference under deterministic mixed updates and removals', () => {
  const heap = new ExpirationHeap<number>()
  const reference = new Map<number, number>()
  let seed = 12345
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed
  }
  for (let step = 0; step < 5000; step++) {
    const key = random() % 100
    // Unique deadlines avoid making any promise about tie ordering.
    const deadline = (random() % 1000) * 100 + key
    heap.set(key, deadline)
    reference.set(key, deadline)
    const now = random() % 100_000
    while (true) {
      const next = [...reference].sort((a, b) => a[1] - b[1])[0]
      if (!next || next[1] > now) {
        expect(heap.popExpired(now)).toBeUndefined()
        break
      }
      expect(heap.popExpired(now)).toBe(next[0])
      reference.delete(next[0])
    }
    expect(heap.size).toBe(reference.size)
  }
})

test('sliding strategy keeps its input immutable and clamps backward timestamps', () => {
  const strategy = slidingWindow(2, Duration.makeUnsafe(100))
  const first = strategy.consume(Option.none(), 50)
  const second = strategy.consume(Option.some(first.state), 25)
  expect(first.state.kind).toBe('sliding-window')
  if (first.state.kind !== 'sliding-window') {
    throw new Error('Wrong state')
  }
  expect(first.state.timestamps.size).toBe(1)
  expect(second.decision.remaining).toBe(0)
  expect(
    strategy.consume(Option.some(second.state), 149).decision.allowed,
  ).toBe(false)
  expect(
    strategy.consume(Option.some(second.state), 150).decision.allowed,
  ).toBe(true)
})

test('sliding limiter matches the original array algorithm over many requests and clients', async () => {
  const repository = new InMemoryRateLimitRepository()
  const strategy = slidingWindow(7, Duration.makeUnsafe(100))
  const logs = new Map<string, number[]>()
  for (let step = 0; step < 5000; step++) {
    const now = Math.floor(step / 3)
    const key = String(step % 5)
    const times = (logs.get(key) ?? []).filter((time) => time > now - 100)
    const allowed = times.length < 7
    if (allowed) {
      times.push(now)
    }
    logs.set(key, times)
    const actual = await repository.consume(key, strategy, now)
    expect(actual.allowed).toBe(allowed)
    expect(actual.remaining).toBe(7 - times.length)
    expect(actual.resetAt).toBe(times.at(-1)! + 100)
    expect(actual.retryAfter.milliseconds).toBe(
      allowed ? 0 : times[0]! + 100 - now,
    )
  }
})

test('cleanup honors extended deadlines and removes clients that never return', async () => {
  const repository = new InMemoryRateLimitRepository()
  const base = slidingWindow(3, Duration.makeUnsafe(100))
  let freshStates = 0
  const strategy = {
    ...base,
    consume: (...args: Parameters<typeof base.consume>) => {
      if (Option.isNone(args[0])) {
        freshStates++
      }
      return base.consume(...args)
    },
  }
  await repository.consume('alice', strategy, 0)
  await repository.consume('bob', strategy, 0)
  await repository.consume('alice', strategy, 50)
  repository.prune(100)
  expect((await repository.consume('alice', strategy, 100)).remaining).toBe(1)
  expect(freshStates).toBe(2)
  await repository.consume('bob', strategy, 100)
  expect(freshStates).toBe(3)
  repository.prune(1000)
  await repository.consume('alice', strategy, 1000)
  expect(freshStates).toBe(4)
})
