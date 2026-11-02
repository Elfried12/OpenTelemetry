import type { Hono } from 'hono'
import type {
  Clock,
  EventRepository,
  IdGenerator,
} from '#/features/events/application/ports.ts'
import type { DemoIdentity } from '#/features/events/application/demo-identity.ts'
import type { CreateEventUseCase } from '#/features/events/application/commands/create-event.ts'
import type { UpdateEventUseCase } from '#/features/events/application/commands/update-event.ts'
import type { ReserveEventUseCase } from '#/features/events/application/commands/reserve-event.ts'
import type { CancelReservationUseCase } from '#/features/events/application/commands/cancel-reservation.ts'
import type { ListEventsUseCase } from '#/features/events/application/queries/list-events.ts'
import type { GetEventUseCase } from '#/features/events/application/queries/get-event.ts'
import type { ListReservationsUseCase } from '#/features/events/application/queries/list-reservations.ts'
import type { EventCommandController } from '#/features/events/controllers/commands/event-controller.ts'
import type { EventQueryController } from '#/features/events/controllers/queries/event-controller.ts'
import type { UserQueryController } from '#/features/events/controllers/queries/user-controller.ts'
import type { DomainEvent } from '#/features/events/contracts/events.ts'
import type { NotificationCommandController } from '#/features/notifications/controllers/commands/notification-controller.ts'
import type { NotificationQueryController } from '#/features/notifications/controllers/queries/notification-controller.ts'
import type { NotificationService } from '#/features/notifications/application/notification-service.ts'
import type { NotificationRepository } from '#/features/notifications/application/ports.ts'
import type { EventBus, Unsubscribe } from '#/shared-kernel/event-bus.ts'
import { createToken } from '#/infrastructure/di/token.ts'

export const TOKEN = {
  EventRepository: createToken<EventRepository>('EventRepository'),
  Clock: createToken<Clock>('Clock'),
  IdGenerator: createToken<IdGenerator>('IdGenerator'),
  EventBus: createToken<EventBus<DomainEvent>>('EventBus'),
  NotificationRepository: createToken<NotificationRepository>(
    'NotificationRepository',
  ),
  NotificationService: createToken<NotificationService>('NotificationService'),
  NotificationCommandController: createToken<NotificationCommandController>(
    'NotificationCommandController',
  ),
  NotificationQueryController: createToken<NotificationQueryController>(
    'NotificationQueryController',
  ),
  NotificationSubscription: createToken<Unsubscribe>(
    'NotificationSubscription',
  ),
  Identity: createToken<DemoIdentity>('Identity'),
  CreateEventUseCase: createToken<CreateEventUseCase>('CreateEventUseCase'),
  UpdateEventUseCase: createToken<UpdateEventUseCase>('UpdateEventUseCase'),
  ReserveEventUseCase: createToken<ReserveEventUseCase>('ReserveEventUseCase'),
  CancelReservationUseCase: createToken<CancelReservationUseCase>(
    'CancelReservationUseCase',
  ),
  ListEventsUseCase: createToken<ListEventsUseCase>('ListEventsUseCase'),
  GetEventUseCase: createToken<GetEventUseCase>('GetEventUseCase'),
  ListReservationsUseCase: createToken<ListReservationsUseCase>(
    'ListReservationsUseCase',
  ),
  EventCommandController: createToken<EventCommandController>(
    'EventCommandController',
  ),
  EventQueryController: createToken<EventQueryController>(
    'EventQueryController',
  ),
  UserQueryController: createToken<UserQueryController>('UserQueryController'),
  App: createToken<Hono>('App'),
} as const
