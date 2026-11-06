import type { OutboxStore } from './ports.ts'
import type { EventBus } from '#/shared-kernel/event-bus.ts'
import type { DomainEvent } from '#/features/events/contracts/events.ts'

export class OutboxDispatcher {
  constructor(
    private readonly store: OutboxStore,
    private readonly bus: EventBus<DomainEvent>,
  ) {}

  // Bounded manual exercise. Stop on failure; the next drain retries that message.
  async drain(limit = 100): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new Error('Invalid drain limit')
    }
    let delivered = 0
    while (
      delivered < limit &&
      (await this.store.deliverNext((message) => this.bus.publish(message)))
    ) {
      delivered++
    }
    return delivered
  }
}
