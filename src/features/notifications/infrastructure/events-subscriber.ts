import type { DomainEvent } from '#/features/events/contracts/events.ts'
import type { NotificationService } from '#/features/notifications/application/notification-service.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'

export interface NotificationLogger {
  log(message: string, envelope: EventEnvelope<DomainEvent>): void
}

// Anti-corruption layer: translate Events' published vocabulary to our own input.
// This is the only Notifications file allowed to import the Events contract.
export function eventsSubscriber(
  service: NotificationService,
  logger: NotificationLogger,
) {
  return async (envelope: EventEnvelope<DomainEvent>): Promise<void> => {
    logger.log(`[notification] ${envelope.event._tag}`, envelope)
    const event = envelope.event
    if (
      event._tag !== 'EventReserved' &&
      event._tag !== 'ReservationCancelled'
    ) {
      return
    }
    await service.receive({
      sourceMessageId: envelope.messageId,
      bookingUserRef: event.content.userId,
      bookingRef: event.content.reservationId,
      kind: event._tag === 'EventReserved' ? 'confirmed' : 'cancelled',
      seats: event.content.quantity,
      occurredAt: envelope.occurredAt,
    })
  }
}
