import { Unauthorized } from '#/features/events/domain/errors.ts'
import type { UserId } from '#/features/events/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import type { EventRepository } from '#/features/events/application/ports.ts'

export class DemoIdentity {
  constructor(private readonly repository: EventRepository) {}

  async requireUser(id: Option<UserId>): Promise<Result<UserId, Unauthorized>> {
    if (Option.isNone(id) || !(await this.repository.userExists(id.value))) {
      return Result.fail(
        new Unauthorized('An authenticated booking user is required'),
      )
    }
    return Result.succeed(id.value)
  }
}
