import type { DemoIdentity } from '#/features/events/application/demo-identity.ts'
import type { ApplicationError } from '#/features/events/application/ports.ts'
import type { UserId } from '#/features/events/domain/ids.ts'
import { userIdSchema } from '#/features/events/validation.ts'
import { parseOption } from '#/shared-kernel/validation.ts'
import { Option } from '#/shared-kernel/option.ts'
import type { Context } from 'hono'
import { Result } from '#/shared-kernel/result.ts'

// Public event responses vary by identity. An invalid supplied identity is not anonymous.
export async function requestViewer(context: Context, identity: DemoIdentity) {
  context.header('Vary', 'X-User-Id', { append: true })
  context.header('Cache-Control', 'private, no-store')
  const header = context.req.header('X-User-Id')
  if (header === undefined) {
    return Result.succeed(Option.none<UserId>())
  }
  return Result.map(
    await requestUser(identity, Option.some(header)),
    Option.some,
  )
}

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
