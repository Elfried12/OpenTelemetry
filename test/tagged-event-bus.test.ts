import { describe, expect, expectTypeOf, mock, spyOn, test } from 'bun:test'

// Standalone demo. The application's existing bus is unchanged.
type Listener<Event> = (event: Event) => void | Promise<void>
type Unsubscribe = () => void

interface TaggedEventBus<Event extends { _tag: string }> {
  subscribe<Tag extends Event['_tag']>(
    tag: Tag,
    listener: Listener<Extract<Event, { _tag: Tag }>>,
  ): Unsubscribe
  publish(event: Event): Promise<void>
}

class InMemoryTaggedEventBus<
  Event extends { _tag: string },
> implements TaggedEventBus<Event> {
  private readonly listenersByTag = new Map<
    Event['_tag'],
    Set<Listener<Event>>
  >()

  subscribe<Tag extends Event['_tag']>(
    tag: Tag,
    listener: Listener<Extract<Event, { _tag: Tag }>>,
  ): Unsubscribe {
    // Only this tag's bucket is dispatched. The guard narrows its payload without a cast.
    const matches = (event: Event): event is Extract<Event, { _tag: Tag }> =>
      event._tag === tag
    const receive: Listener<Event> = (event) => {
      if (matches(event)) {
        return listener(event)
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

  async publish(event: Event): Promise<void> {
    const listeners = this.listenersByTag.get(event._tag)
    if (!listeners) {
      return
    }
    const results = await Promise.allSettled(
      [...listeners].map(async (listener) => listener(event)),
    )
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Tagged event listener failed', result.reason)
      }
    }
  }
}

type EventCreated = { _tag: 'EventCreated'; eventId: string; title: string }
// type EventDeleted = { _tag: 'EventDeleted'; eventId: string; title: string }
type EventReserved = {
  _tag: 'EventReserved'
  eventId: string
  quantity: number
}
type DomainEvent = EventCreated | EventReserved

const created: EventCreated = {
  _tag: 'EventCreated',
  eventId: 'event-1',
  title: 'TypeScript workshop',
}
const reserved: EventReserved = {
  _tag: 'EventReserved',
  eventId: 'event-1',
  quantity: 2,
}

describe('tagged event bus demo', () => {
  test('infers the exact event type from the subscribed tag', async () => {
    const bus: TaggedEventBus<DomainEvent> =
      new InMemoryTaggedEventBus<DomainEvent>()
    const titles: string[] = []
    const quantities: number[] = []

    // bus.subscribe("EventDeleted", (e) => console.log(e))
    bus.subscribe('EventCreated', (event) => {
      expectTypeOf(event).toEqualTypeOf<EventCreated>()
      titles.push(event.title)
    })
    bus.subscribe('EventReserved', (event) => {
      expectTypeOf(event).toEqualTypeOf<EventReserved>()
      quantities.push(event.quantity)
    })

    await bus.publish(created)
    await bus.publish(reserved)

    expect(titles).toEqual(['TypeScript workshop'])
    expect(quantities).toEqual([2])
  })

  test('delivers the original payload to every matching subscriber and no others', async () => {
    const bus = new InMemoryTaggedEventBus<DomainEvent>()
    const first = mock((_event: EventReserved) => {})
    const second = mock((_event: EventReserved) => {})
    const unrelated = mock((_event: EventCreated) => {})
    bus.subscribe('EventReserved', first)
    bus.subscribe('EventReserved', second)
    bus.subscribe('EventCreated', unrelated)

    await bus.publish(reserved)

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first.mock.calls[0]?.[0]).toBe(reserved)
    expect(second.mock.calls[0]?.[0]).toBe(reserved)
    expect(unrelated).not.toHaveBeenCalled()
  })

  test('unsubscribes one registration without removing another for the same callback', async () => {
    const bus = new InMemoryTaggedEventBus<DomainEvent>()
    const listener = mock((_event: EventReserved) => {})
    const unsubscribe = bus.subscribe('EventReserved', listener)
    bus.subscribe('EventReserved', listener)

    await bus.publish(reserved)
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    unsubscribe()
    await bus.publish(reserved)
    expect(listener).toHaveBeenCalledTimes(3)
  })

  test('an old unsubscribe cannot remove a replacement subscription bucket', async () => {
    const bus = new InMemoryTaggedEventBus<DomainEvent>()
    const listener = mock((_event: EventReserved) => {})
    const unsubscribe = bus.subscribe('EventReserved', listener)
    unsubscribe()
    bus.subscribe('EventReserved', listener)
    unsubscribe()

    await bus.publish(reserved)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('subscription changes during delivery affect only subsequent publications', async () => {
    const bus = new InMemoryTaggedEventBus<DomainEvent>()
    const received: string[] = []
    let unsubscribe = () => {}
    bus.subscribe('EventReserved', () => {
      unsubscribe()
    })
    unsubscribe = bus.subscribe('EventReserved', () => {
      received.push('reservation')
    })

    await bus.publish(reserved)
    await bus.publish(reserved)
    expect(received).toEqual(['reservation'])
  })

  test('does not replay messages published before subscription', async () => {
    const bus = new InMemoryTaggedEventBus<DomainEvent>()
    await bus.publish(reserved)

    const listener = mock((_event: EventReserved) => {})
    bus.subscribe('EventReserved', listener)
    expect(listener).not.toHaveBeenCalled()

    const next: EventReserved = { ...reserved, quantity: 3 }
    await bus.publish(next)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(next)
  })

  test('starts other listeners while an async listener is pending and awaits its completion', async () => {
    const bus = new InMemoryTaggedEventBus<DomainEvent>()
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let completed = false
    let published = false
    const fast = mock(() => {})
    bus.subscribe('EventReserved', async () => {
      started.resolve()
      await release.promise
      completed = true
    })
    bus.subscribe('EventReserved', fast)

    const publishing = bus.publish(reserved).then(() => {
      published = true
    })
    try {
      await started.promise
      expect(fast).toHaveBeenCalledTimes(1)
      expect(completed).toBe(false)
      expect(published).toBe(false)
    } finally {
      release.resolve()
      await publishing
    }
    expect(completed).toBe(true)
    expect(published).toBe(true)
  })

  test('isolates both thrown errors and rejected promises without skipping healthy subscribers', async () => {
    const bus = new InMemoryTaggedEventBus<DomainEvent>()
    const thrown = new Error('Synchronous failure')
    const rejected = new Error('Asynchronous failure')
    const log = spyOn(console, 'error').mockImplementation(() => {})
    const healthy = mock((_event: EventReserved) => {})
    bus.subscribe('EventReserved', () => {
      throw thrown
    })
    bus.subscribe('EventReserved', () => Promise.reject(rejected))
    bus.subscribe('EventReserved', healthy)

    try {
      await bus.publish(reserved)
      expect(healthy).toHaveBeenCalledTimes(1)
      expect(healthy).toHaveBeenCalledWith(reserved)
      expect(log).toHaveBeenCalledTimes(2)
      expect(log).toHaveBeenCalledWith('Tagged event listener failed', thrown)
      expect(log).toHaveBeenCalledWith('Tagged event listener failed', rejected)
    } finally {
      log.mockRestore()
    }
  })
})
