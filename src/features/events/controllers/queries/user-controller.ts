import type { Context } from 'hono'
import type { DemoIdentity } from '#/features/events/application/demo-identity.ts'
import type { ListReservationsUseCase } from '#/features/events/application/queries/list-reservations.ts'
import { httpFailure } from '#/features/events/controllers/http-result.ts'
import { presentReservationResource } from '#/features/events/presentation/resources.ts'
import { requestUser } from '#/features/events/request.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'

export function createUserQueryController({
  reservationsFor,
  identity,
}: {
  reservationsFor: ListReservationsUseCase
  identity: DemoIdentity
}) {
  return {
    reservations: async (context: Context) => {
      const user = await requestUser(
        identity,
        Option.fromNullable(context.req.header('X-User-Id')),
      )
      if (Result.isFailure(user)) {
        return httpFailure(context, user.error)
      }
      const reservations = await reservationsFor.execute(user.value)
      return context.json(reservations.map(presentReservationResource))
    },
  }
}
export type UserQueryController = ReturnType<typeof createUserQueryController>
