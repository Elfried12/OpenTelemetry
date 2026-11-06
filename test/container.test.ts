import { describe, expect, test } from 'bun:test'
import {
  Container,
  CircularDependencyError,
  DuplicateRegistrationError,
  UnknownRegistrationError,
} from '#/platform/di/container.ts'
import { createToken } from '#/platform/di/token.ts'

describe('Container', () => {
  test('singletons are cached and factories are recreated', () => {
    const singleton = createToken<object>('singleton')
    const factory = createToken<object>('factory')
    const container = new Container()
      .singleton(singleton, () => ({}))
      .factory(factory, () => ({}))
    expect(container.resolve(singleton)).toBe(container.resolve(singleton))
    expect(container.resolve(factory)).not.toBe(container.resolve(factory))
  })

  test('undefined is a cached singleton value', () => {
    const token = createToken<undefined>('undefined')
    let calls = 0
    const container = new Container().singleton(token, () => {
      calls++
      return undefined
    })
    container.resolve(token)
    container.resolve(token)
    expect(calls).toBe(1)
  })

  test('token identity is independent of description and unknown/duplicate registrations fail', () => {
    const first = createToken<number>('same')
    const second = createToken<number>('same')
    const container = new Container().singleton(first, () => 1)
    expect(() => container.resolve(second)).toThrow(UnknownRegistrationError)
    expect(() => container.singleton(first, () => 2)).toThrow(
      DuplicateRegistrationError,
    )
    container.singleton(second, () => 2)
    expect(container.resolve(first)).toBe(1)
    expect(container.resolve(second)).toBe(2)
  })

  test('circular dependencies fail and failed resolution can be retried', () => {
    const token = createToken<number>('cycle')
    let recursive = true
    const container = new Container().singleton(token, (c) =>
      recursive ? c.resolve(token) : 42,
    )
    expect(() => container.resolve(token)).toThrow(CircularDependencyError)
    recursive = false
    expect(container.resolve(token)).toBe(42)
  })

  test('a throwing factory does not poison subsequent resolution', () => {
    const token = createToken<number>('retry')
    let calls = 0
    const container = new Container().singleton(token, () => {
      if (++calls === 1) {
        throw new Error('temporary failure')
      }
      return 42
    })
    expect(() => container.resolve(token)).toThrow('temporary failure')
    expect(container.resolve(token)).toBe(42)
  })
})
