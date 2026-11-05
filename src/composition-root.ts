import { Container } from '#/infrastructure/di/container.ts'
import { TOKEN } from '#/infrastructure/di/tokens.ts'
import { createApp } from '#/app.ts'
import { CreateEventUseCase } from '#/features/events/application/commands/create-event.ts'
import { UpdateEventUseCase } from '#/features/events/application/commands/update-event.ts'
import { ReserveEventUseCase } from '#/features/events/application/commands/reserve-event.ts'
import { CancelReservationUseCase } from '#/features/events/application/commands/cancel-reservation.ts'
import { ListEventsUseCase } from '#/features/events/application/queries/list-events.ts'
import { GetEventUseCase } from '#/features/events/application/queries/get-event.ts'
import { ListReservationsUseCase } from '#/features/events/application/queries/list-reservations.ts'
import { DemoIdentity } from '#/features/events/application/demo-identity.ts'
import type {
  Clock,
  EventRepository,
  EventProjectionRepository,
  IdGenerator,
} from '#/features/events/application/ports.ts'
import { createEventCommandController } from '#/features/events/controllers/commands/event-controller.ts'
import { createEventQueryController } from '#/features/events/controllers/queries/event-controller.ts'
import { createUserQueryController } from '#/features/events/controllers/queries/user-controller.ts'
import { makeId } from '#/features/events/domain/ids.ts'
import type { DomainEvent } from '#/features/events/contracts/events.ts'
import { NotificationService } from '#/features/notifications/application/notification-service.ts'
import type { NotificationRepository } from '#/features/notifications/application/ports.ts'
import {
  eventsSubscriber,
  type NotificationLogger,
} from '#/features/notifications/infrastructure/events-subscriber.ts'
import { InMemoryNotificationRepository } from '#/features/notifications/infrastructure/in-memory-notification-repository.ts'
import { createNotificationCommandController } from '#/features/notifications/controllers/commands/notification-controller.ts'
import { createNotificationQueryController } from '#/features/notifications/controllers/queries/notification-controller.ts'
import { createRecipientMiddleware } from '#/features/notifications/controllers/recipient.ts'
import { notificationRoutes } from '#/features/notifications/routes/notification-routes.ts'
import type { EventBus } from '#/shared-kernel/event-bus.ts'
import { InMemoryEventBus } from '#/infrastructure/messaging/in-memory-event-bus.ts'
import { createEventsReadModelSubscriber } from '#/features/events/infrastructure/events-read-model-subscriber.ts'

export interface ContainerOptions {
  repository: EventRepository
  readRepository?: EventProjectionRepository
  clock?: Clock
  ids?: IdGenerator
  eventBus?: EventBus<DomainEvent>
  notificationLogger?: NotificationLogger
  notificationRepository?: NotificationRepository
}

// Only the composition root resolves tokens. Application code receives ordinary dependencies.
export function createContainer(options: ContainerOptions): Container {
  const container = new Container()
  container
    .singleton(TOKEN.EventRepository, () => options.repository)
    .singleton(
      TOKEN.EventReadRepository,
      () => options.readRepository ?? options.repository,
    )
    .singleton(TOKEN.EventReadModelSubscription, (c) => {
      if (!options.readRepository) {
        return () => {}
      }
      return createEventsReadModelSubscriber(
        options.repository,
        options.readRepository,
      ).subscribe(c.resolve(TOKEN.EventBus))
    })
    .singleton(TOKEN.Clock, () => options.clock ?? { now: () => new Date() })
    .singleton(TOKEN.IdGenerator, () => options.ids ?? { next: makeId })
    .singleton(
      TOKEN.EventBus,
      () => options.eventBus ?? new InMemoryEventBus<DomainEvent>(),
    )
    .singleton(
      TOKEN.NotificationRepository,
      () =>
        options.notificationRepository ?? new InMemoryNotificationRepository(),
    )
    .singleton(
      TOKEN.NotificationService,
      (c) =>
        new NotificationService(
          c.resolve(TOKEN.NotificationRepository),
          () => c.resolve(TOKEN.IdGenerator).next<string>(),
          () => c.resolve(TOKEN.Clock).now(),
        ),
    )
    .singleton(TOKEN.NotificationSubscription, (c) => {
      const notifications = c.resolve(TOKEN.NotificationService)
      const bus = c.resolve(TOKEN.EventBus)
      const listener = eventsSubscriber(
        notifications,
        options.notificationLogger ?? console,
      )
      const unsubscribe = [
        bus.subscribe('EventCreated', listener),
        bus.subscribe('EventUpdated', listener),
        bus.subscribe('EventReserved', listener),
        bus.subscribe('ReservationCancelled', listener),
      ]
      return () => {
        for (const stop of unsubscribe) {
          stop()
        }
      }
    })
    .singleton(
      TOKEN.Identity,
      (c) => new DemoIdentity(c.resolve(TOKEN.EventRepository)),
    )
    .singleton(
      TOKEN.CreateEventUseCase,
      (c) =>
        new CreateEventUseCase(
          c.resolve(TOKEN.EventRepository),
          c.resolve(TOKEN.Clock),
          c.resolve(TOKEN.IdGenerator),
          c.resolve(TOKEN.EventBus),
        ),
    )
    .singleton(
      TOKEN.UpdateEventUseCase,
      (c) =>
        new UpdateEventUseCase(
          c.resolve(TOKEN.EventRepository),
          c.resolve(TOKEN.Clock),
          c.resolve(TOKEN.IdGenerator),
          c.resolve(TOKEN.EventBus),
        ),
    )
    .singleton(
      TOKEN.ReserveEventUseCase,
      (c) =>
        new ReserveEventUseCase(
          c.resolve(TOKEN.EventRepository),
          c.resolve(TOKEN.Clock),
          c.resolve(TOKEN.IdGenerator),
          c.resolve(TOKEN.EventBus),
        ),
    )
    .singleton(
      TOKEN.CancelReservationUseCase,
      (c) =>
        new CancelReservationUseCase(
          c.resolve(TOKEN.EventRepository),
          c.resolve(TOKEN.Clock),
          c.resolve(TOKEN.IdGenerator),
          c.resolve(TOKEN.EventBus),
        ),
    )
    .singleton(
      TOKEN.ListEventsUseCase,
      (c) => new ListEventsUseCase(c.resolve(TOKEN.EventReadRepository)),
    )
    .singleton(
      TOKEN.GetEventUseCase,
      (c) => new GetEventUseCase(c.resolve(TOKEN.EventReadRepository)),
    )
    .singleton(
      TOKEN.ListReservationsUseCase,
      (c) => new ListReservationsUseCase(c.resolve(TOKEN.EventRepository)),
    )
    .singleton(TOKEN.EventCommandController, (c) =>
      createEventCommandController({
        identity: c.resolve(TOKEN.Identity),
        create: c.resolve(TOKEN.CreateEventUseCase),
        update: c.resolve(TOKEN.UpdateEventUseCase),
        reserve: c.resolve(TOKEN.ReserveEventUseCase),
        cancel: c.resolve(TOKEN.CancelReservationUseCase),
      }),
    )
    .singleton(TOKEN.EventQueryController, (c) =>
      createEventQueryController({
        list: c.resolve(TOKEN.ListEventsUseCase),
        get: c.resolve(TOKEN.GetEventUseCase),
      }),
    )
    .singleton(TOKEN.UserQueryController, (c) =>
      createUserQueryController({
        identity: c.resolve(TOKEN.Identity),
        reservationsFor: c.resolve(TOKEN.ListReservationsUseCase),
      }),
    )
    .singleton(TOKEN.NotificationCommandController, (c) =>
      createNotificationCommandController(c.resolve(TOKEN.NotificationService)),
    )
    .singleton(TOKEN.NotificationQueryController, (c) =>
      createNotificationQueryController(c.resolve(TOKEN.NotificationService)),
    )
    .singleton(TOKEN.App, (c) => {
      const app = createApp(
        c.resolve(TOKEN.EventCommandController),
        c.resolve(TOKEN.EventQueryController),
        c.resolve(TOKEN.UserQueryController),
      )
      notificationRoutes(
        app,
        c.resolve(TOKEN.NotificationCommandController),
        c.resolve(TOKEN.NotificationQueryController),
        createRecipientMiddleware(c.resolve(TOKEN.NotificationService)),
      )
      return app
    })

  // Subscribe once even when callers resolve a use case without resolving the HTTP app.
  container.resolve(TOKEN.NotificationSubscription)
  container.resolve(TOKEN.EventReadModelSubscription)
  return container
}
