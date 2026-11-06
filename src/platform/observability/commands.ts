import type { Attributes } from '@opentelemetry/api'
import { inSpan, meter, outcomeOf } from './telemetry.ts'

const commandDuration = meter.createHistogram('app.command.duration', { unit: 's' })
const reservations = meter.createCounter('bookings.reservations', { unit: '{reservation}' })
const seats = meter.createUpDownCounter('bookings.seats.booked', { unit: '{seat}' })

export function observeCommand<C, R>(
  name: string,
  handler: { execute(c: C): Promise<R> },
  describe: (c: C) => Attributes,
  onSuccess?: (c: C) => void,
) {
  const execute = handler.execute.bind(handler)
  handler.execute = (command) => {
    const start = performance.now()
    return inSpan(name, describe(command), async (span) => {
      const result = await execute(command)
      const outcome = outcomeOf(result)
      span.setAttribute('app.outcome', outcome)
      commandDuration.record((performance.now() - start) / 1000, { 'app.command': name, 'app.outcome': outcome })
      if (outcome === 'success') onSuccess?.(command)
      if (name === 'events.reserve' || name === 'events.cancel') {
        reservations.add(1, { operation: name, 'app.outcome': outcome })
      }
      return result
    })
  }
  return handler
}
export const bookingSeats = seats
