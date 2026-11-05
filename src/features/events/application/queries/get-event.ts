import type { EventReadRepository } from '#/features/events/application/ports.ts'
import type { Event } from '#/features/events/domain/event.ts'
import type { EventId } from '#/features/events/domain/ids.ts'
import { NotFound } from '#/features/events/domain/errors.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import type { QueryHandler } from '#/shared-kernel/query-handler.ts'

export class GetEventUseCase implements QueryHandler<
  EventId,
  Result<Event, NotFound>
> {
  constructor(private readonly repository: EventReadRepository) {}

  async execute(id: EventId) {
    const event = await this.repository.findEvent(id)
    if (Option.isNone(event)) {
      return Result.fail(new NotFound('Event not found'))
    }
    return Result.succeed(event.value)
  }
}
