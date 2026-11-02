import {
  Event,
  EventData,
  type EventInput,
} from '#/features/events/domain/event.ts'
import type { CommandHandler } from '#/shared-kernel/command-handler.ts'
import type { ApplicationError } from '#/features/events/application/ports.ts'
import type { EventId } from '#/features/events/domain/ids.ts'
import { InvalidInput } from '#/features/events/domain/errors.ts'
import { Result } from '#/shared-kernel/result.ts'
import type {
  Clock,
  EventRepository,
  IdGenerator,
} from '#/features/events/application/ports.ts'
import type { EventBus } from '#/shared-kernel/event-bus.ts'
import type { DomainEvent } from '#/features/events/contracts/events.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'

export class CreateEventUseCase implements CommandHandler<
  EventInput,
  Result<Event, ApplicationError>
> {
  constructor(
    private readonly repository: EventRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly eventBus: EventBus<DomainEvent>,
  ) {}

  async execute(input: EventInput) {
    const result = Event.create({ ...input, id: this.ids.next<EventId>() })
    const now = this.clock.now()
    if (Result.isFailure(result)) {
      return result
    }
    if (result.value.data.startsAt <= now) {
      return Result.fail(new InvalidInput('Event must start in the future'))
    }
    const persisted = await this.repository.createEvent(result.value)
    if (Result.isSuccess(persisted)) {
      const success = persisted.value.data
      await this.eventBus.publish(this.envelope(success))
    }
    return persisted
  }

  private envelope(event: EventData): EventEnvelope<DomainEvent> {
    return {
      messageId: this.ids.next<string>(),
      occurredAt: this.clock.now(),
      version: 1,
      event: eventCreated(event),
    }
  }
}

const eventCreated = (success: Readonly<EventData>) => ({
  _tag: 'EventCreated' as const,
  content: {
    eventId: success.id,
    title: success.title,
    category: success.category,
    startsAt: success.startsAt,
    capacity: success.capacity.value,
    venueId: success.venueId,
  },
})
