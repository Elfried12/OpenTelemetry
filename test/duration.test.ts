import { expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { Duration, InvalidDuration } from '#/shared-kernel/duration.ts'
import { given } from './support/given.ts'

test.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  'Duration rejects invalid milliseconds: %p',
  (value) =>
    given(() => value)
      .when((milliseconds) => ({
        result: Duration.create(milliseconds),
        unsafeConstructor: () => Duration.makeUnsafe(milliseconds),
      }))
      .then(({ result, unsafeConstructor }) => {
        expect(result).toMatchObject({
          _tag: 'Failure',
          error: expect.any(InvalidDuration),
        })
        expect(unsafeConstructor).toThrow(InvalidDuration)
      }),
)

test('Duration supports zero, value equality and HTTP whole-second rounding', () =>
  given(() => ({
    zero: Duration.makeUnsafe(0),
    oneSecond: Duration.makeUnsafe(1000),
    sameSecond: Duration.makeUnsafe(1000),
    longer: Duration.makeUnsafe(1001),
    fractionalSeconds: Duration.makeUnsafe(1500),
  }))
    .when(({ zero, oneSecond, sameSecond, longer, fractionalSeconds }) => ({
      isZero: zero.isZero(),
      seconds: fractionalSeconds.toSeconds(),
      roundedSeconds: fractionalSeconds.toWholeSeconds(),
      wholeSeconds: oneSecond.toWholeSeconds(),
      equalValues: oneSecond.equals(sameSecond),
      differentValues: oneSecond.equals(longer),
      frozen: Object.isFrozen(oneSecond),
    }))
    .then(
      ({
        isZero,
        seconds,
        roundedSeconds,
        wholeSeconds,
        equalValues,
        differentValues,
        frozen,
      }) => {
        expect(isZero).toBe(true)
        expect(seconds).toBe(1.5)
        expect(roundedSeconds).toBe(2)
        expect(wholeSeconds).toBe(1)
        expect(equalValues).toBe(true)
        expect(differentValues).toBe(false)
        expect(frozen).toBe(true)
      },
    ))

const maxMilliseconds = Number.MAX_SAFE_INTEGER

test.each([
  { leftMs: 0, rightMs: 0, expectedMs: 0 },
  { leftMs: 1000, rightMs: 500, expectedMs: 1500 },
  { leftMs: maxMilliseconds - 1, rightMs: 1, expectedMs: maxMilliseconds },
  { leftMs: maxMilliseconds, rightMs: 0, expectedMs: maxMilliseconds },
])(
  'Duration adds $leftMs ms and $rightMs ms without mutating its operands',
  ({ leftMs, rightMs, expectedMs }) =>
    given(() => ({
      left: Duration.makeUnsafe(leftMs),
      right: Duration.makeUnsafe(rightMs),
    }))
      .when(({ left, right }) => left.add(right))
      .then((result, { left, right }) => {
        assert(result._tag === 'Success', 'Expected a valid sum of durations')
        expect(result.value.equals(Duration.makeUnsafe(expectedMs))).toBe(true)
        expect(result.value).not.toBe(left)
        expect(result.value).not.toBe(right)
        expect(Object.isFrozen(result.value)).toBe(true)
        expect(left.milliseconds).toBe(leftMs)
        expect(right.milliseconds).toBe(rightMs)
      }),
)

test.each([1, maxMilliseconds])(
  'Duration rejects addition that exceeds the safe-integer range by adding %p ms',
  (rightMs) =>
    given(() => ({
      left: Duration.makeUnsafe(maxMilliseconds),
      right: Duration.makeUnsafe(rightMs),
    }))
      .when(({ left, right }) => left.add(right))
      .then((result, { left, right }) => {
        assert(result._tag === 'Failure', 'Expected an overflow failure')
        expect(result.error).toBeInstanceOf(InvalidDuration)
        expect(left.milliseconds).toBe(maxMilliseconds)
        expect(right.milliseconds).toBe(rightMs)
      }),
)

test.each([
  { leftMs: 1500, rightMs: 500, expectedMs: 1000 },
  { leftMs: 1000, rightMs: 0, expectedMs: 1000 },
  { leftMs: 1000, rightMs: 1000, expectedMs: 0 },
  { leftMs: 0, rightMs: 0, expectedMs: 0 },
  { leftMs: maxMilliseconds, rightMs: 1, expectedMs: maxMilliseconds - 1 },
])(
  'Duration subtracts $rightMs ms from $leftMs ms without mutating its operands',
  ({ leftMs, rightMs, expectedMs }) =>
    given(() => ({
      left: Duration.makeUnsafe(leftMs),
      right: Duration.makeUnsafe(rightMs),
    }))
      .when(({ left, right }) => left.subtract(right))
      .then((result, { left, right }) => {
        assert(
          result._tag === 'Success',
          'Expected a valid difference of durations',
        )
        expect(result.value.equals(Duration.makeUnsafe(expectedMs))).toBe(true)
        expect(result.value).not.toBe(left)
        expect(result.value).not.toBe(right)
        expect(Object.isFrozen(result.value)).toBe(true)
        expect(left.milliseconds).toBe(leftMs)
        expect(right.milliseconds).toBe(rightMs)
      }),
)

test.each([
  { leftMs: 0, rightMs: 1 },
  { leftMs: 500, rightMs: 1000 },
])(
  'Duration rejects subtracting $rightMs ms from $leftMs ms instead of clamping to zero',
  ({ leftMs, rightMs }) =>
    given(() => ({
      left: Duration.makeUnsafe(leftMs),
      right: Duration.makeUnsafe(rightMs),
    }))
      .when(({ left, right }) => left.subtract(right))
      .then((result, { left, right }) => {
        assert(
          result._tag === 'Failure',
          'Expected a negative-duration failure',
        )
        expect(result.error).toBeInstanceOf(InvalidDuration)
        expect(left.milliseconds).toBe(leftMs)
        expect(right.milliseconds).toBe(rightMs)
      }),
)

test.each([
  {
    leftMs: 0,
    rightMs: 0,
    lower: false,
    higher: false,
    equal: true,
    zero: true,
  },
  {
    leftMs: 0,
    rightMs: 1,
    lower: true,
    higher: false,
    equal: false,
    zero: true,
  },
  {
    leftMs: 1000,
    rightMs: 1000,
    lower: false,
    higher: false,
    equal: true,
    zero: false,
  },
  {
    leftMs: 1000,
    rightMs: 1001,
    lower: true,
    higher: false,
    equal: false,
    zero: false,
  },
  {
    leftMs: 1001,
    rightMs: 1000,
    lower: false,
    higher: true,
    equal: false,
    zero: false,
  },
  {
    leftMs: maxMilliseconds,
    rightMs: 0,
    lower: false,
    higher: true,
    equal: false,
    zero: false,
  },
])(
  'Duration compares $leftMs ms with $rightMs ms by value',
  ({ leftMs, rightMs, lower, higher, equal, zero }) =>
    given(() => ({
      left: Duration.makeUnsafe(leftMs),
      right: Duration.makeUnsafe(rightMs),
    }))
      .when(({ left, right }) => ({
        isLower: left.isLowerThan(right),
        isHigher: left.isHigherThan(right),
        isEqual: left.equals(right),
        isZero: left.isZero(),
      }))
      .then(({ isLower, isHigher, isEqual, isZero }) => {
        expect(isLower).toBe(lower)
        expect(isHigher).toBe(higher)
        expect(isEqual).toBe(equal)
        expect(isZero).toBe(zero)
      }),
)
