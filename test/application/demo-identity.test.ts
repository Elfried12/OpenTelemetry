import { expect, test } from 'bun:test'
import { Unauthorized } from '#/features/events/domain/errors.ts'
import { UserId } from '#/features/events/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import { anApplication } from '../support/application-fixture.ts'
import { given } from '../support/given.ts'

test('a known user is accepted', () =>
  given(anApplication)
    .when(({ services, alice }) =>
      services.identity.requireUser(Option.some(alice)),
    )
    .then((result, { alice }) => {
      expect(result).toEqual(Result.succeed(alice))
    }))

test.each([Option.none<UserId>(), Option.some(UserId.make())])(
  'an absent or unknown identity is unauthorized: %j',
  (identity) =>
    given(anApplication)
      .when(({ services }) => services.identity.requireUser(identity))
      .then((result) => {
        expect(result).toEqual(
          Result.fail(
            new Unauthorized('An authenticated booking user is required'),
          ),
        )
      }),
)
