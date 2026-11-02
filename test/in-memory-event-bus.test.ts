import { describe, expect, expectTypeOf, mock, spyOn, test } from 'bun:test'
import type { EventBus } from '#/shared-kernel/event-bus.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'
import { InMemoryEventBus } from '#/infrastructure/messaging/in-memory-event-bus.ts'

type Created = { _tag: 'Created'; title: string }
type Reserved = { _tag: 'Reserved'; quantity: number }
type Event = Created | Reserved

const created: EventEnvelope<Created> = {
  messageId: 'message-1',
  occurredAt: new Date('2030-01-01'),
  version: 1,
  event: { _tag: 'Created', title: 'Workshop' },
}
const reserved: EventEnvelope<Reserved> = {
  ...created,
  messageId: 'message-2',
  event: { _tag: 'Reserved', quantity: 2 },
}

describe('InMemoryEventBus', () => {
  test('infers the exact envelope payload from the subscribed tag', async () => {
    const bus: EventBus<Event> = new InMemoryEventBus<Event>()
    const titles: string[] = []
    const quantities: number[] = []
    bus.subscribe('Created', (message) => {
      expectTypeOf(message).toEqualTypeOf<EventEnvelope<Created>>()
      titles.push(message.event.title)
    })
    bus.subscribe('Reserved', (message) => {
      expectTypeOf(message).toEqualTypeOf<EventEnvelope<Reserved>>()
      quantities.push(message.event.quantity)
    })
    await bus.publish(created)
    await bus.publish(reserved)
    expect(titles).toEqual(['Workshop'])
    expect(quantities).toEqual([2])
  })

  test('delivers the original envelope only to matching subscribers', async () => {
    const bus = new InMemoryEventBus<Event>()
    const first = mock((_message: EventEnvelope<Reserved>) => {})
    const second = mock((_message: EventEnvelope<Reserved>) => {})
    const unrelated = mock((_message: EventEnvelope<Created>) => {})
    bus.subscribe('Reserved', first)
    bus.subscribe('Reserved', second)
    bus.subscribe('Created', unrelated)
    await bus.publish(reserved)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first.mock.calls[0]?.[0]).toBe(reserved)
    expect(second.mock.calls[0]?.[0]).toBe(reserved)
    expect(unrelated).not.toHaveBeenCalled()
  })

  test('does not replay messages published before subscription', async () => {
    const bus = new InMemoryEventBus<Event>()
    await bus.publish(reserved)
    const listener = mock(() => {})
    bus.subscribe('Reserved', listener)
    expect(listener).not.toHaveBeenCalled()
    await bus.publish(reserved)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('unsubscribes independently and idempotently, even for the same callback', async () => {
    const bus = new InMemoryEventBus<Event>()
    const listener = mock(() => {})
    const unsubscribe = bus.subscribe('Reserved', listener)
    bus.subscribe('Reserved', listener)
    await bus.publish(reserved)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    unsubscribe()
    await bus.publish(reserved)
    expect(listener).toHaveBeenCalledTimes(3)
  })

  test('an old unsubscribe cannot remove a replacement bucket', async () => {
    const bus = new InMemoryEventBus<Event>()
    const listener = mock(() => {})
    const unsubscribe = bus.subscribe('Reserved', listener)
    unsubscribe()
    bus.subscribe('Reserved', listener)
    unsubscribe()
    await bus.publish(reserved)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('subscription changes during publish only affect future publications', async () => {
    const bus = new InMemoryEventBus<Event>()
    const received: string[] = []
    let unsubscribe = () => {}
    let changed = false
    bus.subscribe('Reserved', () => {
      if (!changed) {
        changed = true
        unsubscribe()
        bus.subscribe('Reserved', () => {
          received.push('new')
        })
      }
    })
    unsubscribe = bus.subscribe('Reserved', () => {
      received.push('original')
    })
    await bus.publish(reserved)
    await bus.publish(reserved)
    expect(received).toEqual(['original', 'new'])
  })

  test('starts listeners concurrently and awaits completion', async () => {
    const bus = new InMemoryEventBus<Event>()
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let completed = false
    let published = false
    const fast = mock(() => {})
    bus.subscribe('Reserved', async () => {
      started.resolve()
      await release.promise
      completed = true
    })
    bus.subscribe('Reserved', fast)
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

  test('isolates thrown errors and rejected promises without skipping healthy listeners', async () => {
    const bus = new InMemoryEventBus<Event>()
    const thrown = new Error('Synchronous failure')
    const rejected = new Error('Asynchronous failure')
    const log = spyOn(console, 'error').mockImplementation(() => {})
    const healthy = mock(() => {})
    bus.subscribe('Reserved', () => {
      throw thrown
    })
    bus.subscribe('Reserved', () => Promise.reject(rejected))
    bus.subscribe('Reserved', healthy)
    try {
      await bus.publish(reserved)
      expect(healthy).toHaveBeenCalledWith(reserved)
      expect(log).toHaveBeenCalledTimes(2)
      expect(log).toHaveBeenCalledWith('Event listener failed', thrown)
      expect(log).toHaveBeenCalledWith('Event listener failed', rejected)
    } finally {
      log.mockRestore()
    }
  })
})
