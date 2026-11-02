import * as v from 'valibot'
import { Result } from '#/shared-kernel/result.ts'
import { Option } from '#/shared-kernel/option.ts'
import { InvalidInput } from '#/shared-kernel/errors.ts'

export function parseOption<T extends v.GenericSchema>(
  schema: T,
  input: Option<unknown>,
): Result<Option<v.InferOutput<T>>, InvalidInput> {
  if (Option.isNone(input)) {
    return Result.succeed(Option.none())
  }
  return Result.map(parse(schema, input.value), Option.some)
}

export function parse<T extends v.GenericSchema>(
  schema: T,
  input: unknown,
): Result<v.InferOutput<T>, InvalidInput> {
  const result = v.safeParse(schema, input)
  if (!result.success) {
    return Result.fail(
      new InvalidInput(result.issues.map((issue) => issue.message).join('; ')),
    )
  }
  return Result.succeed(result.output)
}
