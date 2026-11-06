import type * as v from 'valibot'
import { InvalidInput } from '#/shared-kernel/errors.ts'
import { Result } from '#/shared-kernel/result.ts'
import { parse } from '#/shared-kernel/validation.ts'

export async function requestJson<Schema extends v.GenericSchema>(
  request: Request,
  schema: Schema,
): Promise<Result<v.InferOutput<Schema>, InvalidInput>> {
  const input = await Result.tryPromise(
    (): Promise<unknown> => request.json(),
    () => new InvalidInput('Request body must be valid JSON'),
  )
  if (Result.isFailure(input)) {
    return input
  }
  return parse(schema, input.value)
}
