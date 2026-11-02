import { describe, expect, test } from 'bun:test'
import * as v from 'valibot'
import { InvalidInput } from '#/features/events/domain/errors.ts'
import { UserId } from '#/features/events/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import { userIdSchema } from '#/features/events/validation.ts'
import { parse, parseOption } from '#/shared-kernel/validation.ts'

describe('parseOption', () => {
  test('preserves None without running the schema', () => {
    const schema = v.pipe(
      v.string(),
      v.transform(() => {
        throw new Error('None must not be parsed')
      }),
    )

    expect(parseOption(schema, Option.none())).toEqual(
      Result.succeed(Option.none()),
    )
  })

  test('parses and transforms Some into the schema output', () => {
    const id = '01900000-0000-7000-8000-000000000001'

    expect(parseOption(userIdSchema, Option.some(id))).toEqual(
      Result.succeed(Option.some(UserId.makeUnsafe(id))),
    )
  })

  test('preserves validation failures instead of turning them into None', () => {
    const result = parseOption(userIdSchema, Option.some('invalid'))

    expect(result).toEqual(
      Result.map(parse(userIdSchema, 'invalid'), Option.some),
    )
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error).toBeInstanceOf(InvalidInput)
    }
  })
})
