import { describe, expect, expectTypeOf, mock, test } from 'bun:test'

// Alternative to tags: constructors are runtime subscription keys.
// subscribe<EventCreated>(listener) alone cannot work: generics are erased.
type Listener<Event> = (event: Event) => void | Promise<void>
type EventClass<Event> = (abstract new (...args: never[]) => Event) & {
  readonly prototype: Event
}

class InheritanceEventBus<Event extends object> {
  private readonly listenersByPrototype = new Map<
    object,
    Set<Listener<Event>>
  >()

  subscribe<Selected extends Event>(
    eventClass: EventClass<Selected>,
    listener: Listener<Selected>,
  ): () => void {
    const receive: Listener<Event> = (event) => {
      if (event instanceof eventClass) {
        return listener(event)
      }
    }
    const prototype = eventClass.prototype
    let listeners = this.listenersByPrototype.get(prototype)
    if (!listeners) {
      listeners = new Set()
      this.listenersByPrototype.set(prototype, listeners)
    }
    const bucket = listeners
    bucket.add(receive)
    return () => {
      bucket.delete(receive)
      if (
        bucket.size === 0 &&
        this.listenersByPrototype.get(prototype) === bucket
      ) {
        this.listenersByPrototype.delete(prototype)
      }
    }
  }

  async publish(event: Event): Promise<void> {
    // Walk the instance's ancestors, not all registered subscription types.
    // Snapshot all matching buckets before running callbacks.
    const listeners: Listener<Event>[] = []
    let prototype: object | null = Object.getPrototypeOf(event)
    while (prototype !== null) {
      const bucket = this.listenersByPrototype.get(prototype)
      if (bucket) {
        listeners.push(...bucket)
      }
      prototype = Object.getPrototypeOf(prototype)
    }

    const results = await Promise.allSettled(
      listeners.map(async (listener) => listener(event)),
    )
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Inheritance event listener failed', result.reason)
      }
    }
  }
}

abstract class DomainEvent {
  constructor(readonly eventId: string) { }
}

class EventCreated extends DomainEvent {
  constructor(
    eventId: string,
    readonly title: string,
  ) {
    super(eventId)
  }
}

class OnlineEventCreated extends EventCreated {
  constructor(
    eventId: string,
    title: string,
    readonly meetingUrl: string,
  ) {
    super(eventId, title)
  }
}

class EventReserved extends DomainEvent {
  constructor(
    eventId: string,
    readonly quantity: number,
  ) {
    super(eventId)
  }
}

describe('inheritance event bus demo', () => {
  test('infers the listener type from the constructor', async () => {
    const bus = new InheritanceEventBus<DomainEvent>()
    const titles: string[] = []
    bus.subscribe(EventCreated, (event) => {
      expectTypeOf(event).toEqualTypeOf<EventCreated>()
      titles.push(event.title)
    })

    await bus.publish(new EventCreated('event-1', 'TypeScript workshop'))
    expect(titles).toEqual(['TypeScript workshop'])
  })

  test('notifies exact-type and ancestor subscribers, but not unrelated subscribers', async () => {
    const bus = new InheritanceEventBus<DomainEvent>()
    const allEvents = mock((_event: DomainEvent) => { })
    const creations = mock((_event: EventCreated) => { })
    const onlineCreations = mock((_event: OnlineEventCreated) => { })
    const reservations = mock((_event: EventReserved) => { })
    bus.subscribe(DomainEvent, allEvents)
    bus.subscribe(EventCreated, creations)
    bus.subscribe(OnlineEventCreated, onlineCreations)
    bus.subscribe(EventReserved, reservations)
    const event = new OnlineEventCreated(
      'event-1',
      'TypeScript workshop',
      'https://example.com/meet',
    )

    await bus.publish(event)

    for (const listener of [allEvents, creations, onlineCreations]) {
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener.mock.calls[0]?.[0]).toBe(event)
    }
    expect(reservations).not.toHaveBeenCalled()
  })

  test('does not notify a derived-type subscriber about a base instance', async () => {
    const bus = new InheritanceEventBus<DomainEvent>()
    const onlineCreations = mock((_event: OnlineEventCreated) => { })
    bus.subscribe(OnlineEventCreated, onlineCreations)

    await bus.publish(new EventCreated('event-1', 'In-person workshop'))
    expect(onlineCreations).not.toHaveBeenCalled()
  })

  test('does not treat a structurally compatible plain object as a class instance', async () => {
    const bus = new InheritanceEventBus<DomainEvent>()
    const creations = mock((_event: EventCreated) => { })
    bus.subscribe(EventCreated, creations)

    // TypeScript accepts the shape, but runtime inheritance requires prototypes.
    const plainObject: EventCreated = { eventId: 'event-1', title: 'From JSON' }
    await bus.publish(plainObject)
    expect(creations).not.toHaveBeenCalled()
  })

  test('an old unsubscribe cannot remove a replacement subscription bucket', async () => {
    const bus = new InheritanceEventBus<DomainEvent>()
    const listener = mock((_event: EventCreated) => { })
    const unsubscribe = bus.subscribe(EventCreated, listener)
    unsubscribe()
    bus.subscribe(EventCreated, listener)
    unsubscribe()

    await bus.publish(new EventCreated('event-1', 'TypeScript workshop'))
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
