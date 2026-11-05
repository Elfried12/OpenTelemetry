import type {
  EventFilter,
  EventReadRepository,
} from '#/features/events/application/ports.ts'
import type { Event } from '#/features/events/domain/event.ts'
import type { QueryHandler } from '#/shared-kernel/query-handler.ts'

export class ListEventsUseCase implements QueryHandler<EventFilter, Event[]> {
  constructor(private readonly repository: EventReadRepository) {}

  execute(query: EventFilter) {
    return this.repository.listEvents(query)
  }
}
