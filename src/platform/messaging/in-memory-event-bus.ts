import type {
  EventBus,
  MessageListener,
  Unsubscribe,
} from '#/shared-kernel/event-bus.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'

export class InMemoryEventBus<
  Event extends { _tag: string },
> implements EventBus<Event> {
  private readonly listenersByTag = new Map<
    Event['_tag'],
    Set<MessageListener<Event>>
  >()

  constructor(private readonly propagateFailures = false) {}

  subscribe<Tag extends Event['_tag']>(
    tag: Tag,
    listener: MessageListener<Extract<Event, { _tag: Tag }>>,
  ): Unsubscribe {
    const matches = (
      message: EventEnvelope<Event>,
    ): message is EventEnvelope<Extract<Event, { _tag: Tag }>> =>
      message.event._tag === tag
    const receive: MessageListener<Event> = (message) => {
      if (matches(message)) {
        return listener(message)
      }
    }

    let listeners = this.listenersByTag.get(tag)
    if (!listeners) {
      listeners = new Set()
      this.listenersByTag.set(tag, listeners)
    }
    const bucket = listeners
    bucket.add(receive)
    return () => {
      bucket.delete(receive)
      if (bucket.size === 0 && this.listenersByTag.get(tag) === bucket) {
        this.listenersByTag.delete(tag)
      }
    }
  }

  async publish(message: EventEnvelope<Event>): Promise<void> {
    const listeners = this.listenersByTag.get(message.event._tag)
    if (!listeners) {
      return
    }
    const results = await Promise.allSettled(
      [...listeners].map(async (listener) => listener(message)),
    )
    const failures: unknown[] = []
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Event listener failed', result.reason)
        failures.push(result.reason)
      }
    }
    if (this.propagateFailures && failures.length > 0) {
      throw new AggregateError(failures, 'Event delivery failed')
    }
  }
}
