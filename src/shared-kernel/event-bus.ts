import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'

export type MessageListener<Event> = (
  message: EventEnvelope<Event>,
) => Promise<void> | void
export type Unsubscribe = () => void

export interface EventBus<Event extends { _tag: string }> {
  subscribe<Tag extends Event['_tag']>(
    tag: Tag,
    listener: MessageListener<Extract<Event, { _tag: Tag }>>,
  ): Unsubscribe
  publish(message: EventEnvelope<Event>): Promise<void>
}
