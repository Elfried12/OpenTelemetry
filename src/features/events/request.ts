import type { DemoIdentity } from '#/features/events/application/demo-identity.ts'
import type { ApplicationError } from '#/features/events/application/ports.ts'
import type { UserId } from '#/features/events/domain/ids.ts'
import { userIdSchema } from '#/features/events/validation.ts'
import { parseOption } from '#/shared-kernel/validation.ts'
import type { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'

export async function requestUser(
  identity: DemoIdentity,
  provided: Option<string>,
): Promise<Result<UserId, ApplicationError>> {
  const parsed = parseOption(userIdSchema, provided)
  if (Result.isFailure(parsed)) {
    return parsed
  }
  return identity.requireUser(parsed.value)
}
