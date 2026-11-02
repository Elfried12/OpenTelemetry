import type { NotificationRepository } from '#/features/notifications/application/ports.ts'
import {
  composeNotification,
  type BookingNotice,
  type Notification,
  type Recipient,
} from '#/features/notifications/domain/notification.ts'
import { Option } from '#/shared-kernel/option.ts'

// No Events imports, entities, repositories or business rules.
export class NotificationService {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly nextId: () => string,
    private readonly now: () => Date,
  ) {}

  async receive(notice: BookingNotice): Promise<void> {
    const recipient = await this.repository.findRecipient(notice.bookingUserRef)
    // Enrollment belongs to Notifications. A booking does not create a recipient.
    if (Option.isNone(recipient)) {
      return
    }
    const notification = this.notificationFor(notice, recipient.value)
    await this.repository.recordOnce(
      notice.sourceMessageId,
      recipient.value.id,
      notification,
    )
  }

  recipient(bookingUserRef: string) {
    return this.repository.findRecipient(bookingUserRef)
  }

  preferences(recipientId: string, inboxEnabled: boolean) {
    return this.repository.setInboxEnabled(recipientId, inboxEnabled)
  }

  inbox(recipientId: string) {
    return this.repository.list(recipientId)
  }

  markRead(recipientId: string, notificationId: string) {
    return this.repository.markRead(recipientId, notificationId, this.now())
  }

  private notificationFor(
    notice: BookingNotice,
    recipient: Recipient,
  ): Option<Notification> {
    if (!recipient.inboxEnabled) {
      return Option.none()
    }
    return Option.some(composeNotification(notice, recipient, this.nextId()))
  }
}
