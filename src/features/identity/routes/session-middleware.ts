import { createMiddleware } from 'hono/factory'
import type { SessionService } from '../application/session-service.ts'
import { Unauthorized } from '../domain/errors.ts'
import { httpFailure } from '../controllers/http-result.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'

const bearerPattern = /^Bearer ([0-9a-f]{64})$/i
const authorizedRoutes = [
  { path: '/user/auth', method: 'POST' },
  { path: '/docs', method: '*' },
  { path: '/openapi.json', method: '*' },
]

async function authenticate(
  sessions: SessionService,
  authorization: Option<string>,
) {
  const token = Option.match(authorization, {
    onNone: () => Option.none<string>(),
    onSome: (header) => Option.fromNullable(header.match(bearerPattern)?.[1]),
  })
  if (Option.isNone(token)) {
    return Result.fail(new Unauthorized('A valid bearer session is required'))
  }
  const userId = Option.fromNullable(await sessions.resolve(token.value))
  if (Option.isNone(userId)) {
    return Result.fail(new Unauthorized('A valid bearer session is required'))
  }
  return Result.succeed({ token: token.value, userId: userId.value })
}

declare module 'hono' {
  interface ContextVariableMap {
    identityUserId: string | undefined
    sessionToken: string | undefined
  }
}

export function sessionMiddleware(sessions: SessionService) {
  return createMiddleware(async (c, next) => {
    if (
      authorizedRoutes.some(
        (route) =>
          route.path === c.req.path &&
          (route.method === '*' || route.method === c.req.method),
      )
    ) {
      return next()
    }
    const authorization = Option.fromNullable(c.req.header('Authorization'))
    const legacyIdentity = Option.fromNullable(c.req.header('X-User-Id'))
    if (Option.isNone(authorization) && Option.isNone(legacyIdentity)) {
      return next()
    }
    c.header('Cache-Control', 'private, no-store')
    const identity = await authenticate(sessions, authorization)
    if (Result.isFailure(identity)) {
      return httpFailure(c, identity.error)
    }
    c.set('identityUserId', identity.value.userId)
    c.set('sessionToken', identity.value.token)
    await next()
  })
}
