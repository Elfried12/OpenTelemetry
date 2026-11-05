import type { Context } from 'hono'
import type { ListEventsUseCase } from '#/features/events/application/queries/list-events.ts'
import type { GetEventUseCase } from '#/features/events/application/queries/get-event.ts'
import type { EventFilter } from '#/features/events/application/ports.ts'
import type { EventId } from '#/features/events/domain/ids.ts'
import {
  httpFailure,
  httpResult,
} from '#/features/events/controllers/http-result.ts'
import { presentEventResource } from '#/features/events/presentation/resources.ts'
import type { DemoIdentity } from '#/features/events/application/demo-identity.ts'
import type { Clock } from '#/features/events/application/ports.ts'
import { requestViewer } from '#/features/events/request.ts'
import { Result } from '#/shared-kernel/result.ts'

export function createEventQueryController({
  list,
  get,
  identity,
  clock,
}: {
  list: ListEventsUseCase
  get: GetEventUseCase
  identity: DemoIdentity
  clock: Clock
}) {
  return {
    list: async (context: Context, query: EventFilter) => {
      const viewer = await requestViewer(context, identity)
      if (Result.isFailure(viewer)) {
        return httpFailure(context, viewer.error)
      }
      const events = await list.execute(query)
      const now = clock.now()
      return context.json(
        events.map((event) => presentEventResource(event, viewer.value, now)),
      )
    },

    get: async (context: Context, id: EventId) => {
      const viewer = await requestViewer(context, identity)
      if (Result.isFailure(viewer)) {
        return httpFailure(context, viewer.error)
      }
      return httpResult(context, await get.execute(id), (event) =>
        presentEventResource(event, viewer.value, clock.now()),
      )
    },
  }
}

export type EventQueryController = ReturnType<typeof createEventQueryController>
