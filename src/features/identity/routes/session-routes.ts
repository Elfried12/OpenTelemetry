import type { Hono } from 'hono'
import * as v from 'valibot'
import type { SessionService } from '../application/session-service.ts'
import { requestJson } from '#/infrastructure/http/request.ts'
import {
  documentRoute,
  jsonBody,
  jsonResponse,
} from '#/infrastructure/http/openapi.ts'
import { Result } from '#/shared-kernel/result.ts'

const userIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const authSchema = v.strictObject({
  userId: v.pipe(
    v.string(),
    v.regex(userIdPattern, 'Expected a lowercase UUID v7'),
  ),
})
export const sessionSchema = v.object({
  token: v.string(),
  tokenType: v.literal('Bearer'),
  expiresAt: v.string(),
})

export function sessionRoutes(app: Hono, sessions: SessionService) {
  app.post(
    '/user/auth',
    documentRoute('Identity', {
      operationId: 'createSession',
      summary: 'Create a demo session',
      description:
        'Fake authentication: anyone who knows an existing user UUID can create a session. No password is checked. Copy the returned token into the Bearer authentication control. Sessions expire after 24 hours.',
      requestBody: jsonBody(authSchema, {
        userId: '01900000-0000-7000-8000-000000000001',
      }),
      errors: [400, 401],
      responses: {
        201: jsonResponse(
          sessionSchema,
          {
            token: 'a'.repeat(64),
            tokenType: 'Bearer',
            expiresAt: '2099-01-02T00:00:00.000Z',
          },
          'Session created. The raw token is returned only here.',
        ),
      },
    }),
    async (c) => {
      c.header('Cache-Control', 'no-store')
      const input = await requestJson(c.req.raw, authSchema)
      if (Result.isFailure(input)) {
        return c.json(
          { error: { code: 'INVALID_INPUT', message: input.error.message } },
          400,
        )
      }
      const session = await sessions.create(input.value.userId)
      if (!session) {
        return c.json(
          { error: { code: 'UNAUTHORIZED', message: 'Unknown demo user' } },
          401,
        )
      }
      return c.json(session, 201)
    },
  )
  app.delete(
    '/user/auth',
    documentRoute('Identity', {
      operationId: 'revokeSession',
      summary: 'Invalidate the current session',
      identity: 'required',
      description:
        'Revokes only the supplied bearer token. Other sessions remain valid. An invalid, expired or already revoked token receives 401.',
      responses: { 204: { description: 'Session revoked' } },
    }),
    async (c) => {
      c.header('Cache-Control', 'no-store')
      const token = c.get('sessionToken') as string | undefined
      if (!token) {
        return c.json(
          {
            error: {
              code: 'UNAUTHORIZED',
              message: 'A valid bearer session is required',
            },
          },
          401,
        )
      }
      await sessions.revoke(token)
      return c.body(null, 204)
    },
  )
}
