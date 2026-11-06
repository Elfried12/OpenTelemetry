import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import * as v from 'valibot'
import { SessionService } from '#/features/identity/application/session-service.ts'
import { InMemoryIdentityRepository } from '#/features/identity/infrastructure/in-memory-identity-repository.ts'
import { sessionMiddleware } from '#/features/identity/routes/session-middleware.ts'
import { sessionSchema } from '#/features/identity/routes/session-routes.ts'
import { given } from './support/given.ts'

const alice = '01900000-0000-7000-8000-000000000001'

function anApplication() {
  const sessions = new SessionService(
    new InMemoryIdentityRepository(new Set([alice])),
    'test-application-secret-key-not-for-production',
  )
  const app = new Hono().use('*', sessionMiddleware(sessions))
  app.all('*', (c) =>
    c.json({
      userId: c.get('identityUserId') ?? null,
      token: c.get('sessionToken') ?? null,
    }),
  )
  return { app, sessions }
}

async function anAuthenticatedApplication() {
  const fixture = anApplication()
  const session = v.parse(sessionSchema, await fixture.sessions.create(alice))
  return { ...fixture, session }
}

test.each([
  { path: '/user/auth', method: 'POST' },
  { path: '/docs', method: 'GET' },
  { path: '/openapi.json', method: 'GET' },
])(
  'authorized route bypasses invalid credentials: $method $path',
  ({ path, method }) =>
    given(anApplication)
      .when(({ app }) =>
        app.request(path, { method, headers: { Authorization: 'invalid' } }),
      )
      .then((response) => {
        expect(response.status).toBe(200)
      }),
)

test('anonymous requests continue without a session identity', () =>
  given(anApplication)
    .when(({ app }) => app.request('/events'))
    .then(async (response) => {
      expect(await response.json()).toEqual({ userId: null, token: null })
    }))

test('valid bearer credentials populate the request identity and token', () =>
  given(anAuthenticatedApplication)
    .when(({ app, session }) =>
      app.request('/events', {
        headers: { Authorization: `Bearer ${session.token}` },
      }),
    )
    .then(async (response, { session }) => {
      expect(await response.json()).toEqual({
        userId: alice,
        token: session.token,
      })
    }))

test.each([
  new Headers({ Authorization: 'invalid' }),
  new Headers({ Authorization: `Bearer ${'a'.repeat(64)}` }),
  new Headers({ 'X-User-Id': alice }),
])(
  'invalid supplied credentials follow the unauthorized error mapping: %j',
  (headers) =>
    given(anApplication)
      .when(({ app }) => app.request('/events', { headers }))
      .then(async (response) => {
        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
          error: {
            code: 'UNAUTHORIZED',
            message: 'A valid bearer session is required',
          },
        })
      }),
)

test('the login bypass does not apply to logout', () =>
  given(anApplication)
    .when(({ app }) =>
      app.request('/user/auth', {
        method: 'DELETE',
        headers: { Authorization: 'invalid' },
      }),
    )
    .then((response) => {
      expect(response.status).toBe(401)
    }))

test('revoked sessions are rejected by the middleware', () =>
  given(async () => {
    const fixture = await anAuthenticatedApplication()
    await fixture.sessions.revoke(fixture.session.token)
    return fixture
  })
    .when(({ app, session }) =>
      app.request('/events', {
        headers: { Authorization: `Bearer ${session.token}` },
      }),
    )
    .then((response) => {
      expect(response.status).toBe(401)
    }))
