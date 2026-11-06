import { Scalar } from '@scalar/hono-api-reference'
import { toJsonSchema } from '@valibot/to-json-schema'
import type { Hono } from 'hono'
import {
  describeRoute,
  openAPIRouteHandler,
  resolver,
  type DescribeRouteOptions,
} from 'hono-openapi'
import * as v from 'valibot'

import { errorDtoSchema } from '#/infrastructure/http/dtos.ts'

// InferInput types examples as JSON values before Date and branded-type transforms.
export function jsonContent<Schema extends v.GenericSchema>(
  schema: Schema,
  example: v.InferInput<Schema>,
) {
  return { 'application/json': { schema: resolver(schema), example } }
}

export function jsonBody<Schema extends v.GenericSchema>(
  schema: Schema,
  example: v.InferInput<Schema>,
  description?: string,
) {
  return { required: true, description, content: jsonContent(schema, example) }
}

export function jsonResponse<Schema extends v.GenericSchema>(
  schema: Schema,
  example: v.InferInput<Schema>,
  description: string,
) {
  return { description, content: jsonContent(schema, example) }
}

export function jsonResponseExamples<Schema extends v.GenericSchema>(
  schema: Schema,
  examples: Record<
    string,
    { summary: string; value: NoInfer<v.InferInput<Schema>> }
  >,
  description: string,
) {
  return {
    description,
    content: { 'application/json': { schema: resolver(schema), examples } },
  }
}

export function parameter<Schema extends v.GenericSchema>(
  location: 'path' | 'query' | 'header',
  name: string,
  schema: Schema,
  example: v.InferInput<Schema>,
  description: string,
) {
  return {
    in: location,
    name,
    required: location === 'path' || !v.safeParse(schema, undefined).success,
    // Valibot emits JSON Schema, which OpenAPI 3.1 accepts. The upstream
    // OpenAPI types still model the narrower 3.0 schema type here.
    schema: toJsonSchema(schema, {
      typeMode: 'input',
      errorMode: 'ignore',
    }) as NonNullable<
      Extract<
        NonNullable<DescribeRouteOptions['parameters']>[number],
        { in: string }
      >['schema']
    >,
    example,
    description,
  }
}

const failures = {
  400: ['INVALID_INPUT', 'Request does not satisfy the input constraints'],
  401: ['UNAUTHORIZED', 'A valid bearer session is required'],
  404: ['NOT_FOUND', 'Resource not found'],
  409: ['CONFLICT', 'The operation conflicts with the current state'],
  500: ['INTERNAL_ERROR', 'An unexpected error occurred'],
} as const

type FailureStatus = keyof typeof failures
export type FeatureTag =
  | 'Events'
  | 'Reservations'
  | 'Notifications'
  | 'Identity'

// Add shared JSON error responses and bearer-session requirements to each operation.
export function documentRoute(
  tag: FeatureTag,
  options: Omit<DescribeRouteOptions, 'tags' | 'security'> & {
    operationId: string
    summary: string
    errors?: readonly FailureStatus[]
    identity?: 'optional' | 'required'
  },
) {
  const { errors = [], identity, ...operation } = options
  const security: NonNullable<DescribeRouteOptions['security']> = []
  if (identity === 'optional') {
    security.push({})
  }
  if (identity) {
    security.push({ BearerSession: [] })
  }
  const responses: NonNullable<DescribeRouteOptions['responses']> = {}
  for (const status of new Set<FailureStatus>([
    500,
    ...errors,
    ...(identity ? ([400, 401] as const) : []),
  ])) {
    const [code, message] = failures[status]
    responses[status] = jsonResponse(
      errorDtoSchema,
      { error: { code, message } },
      message,
    )
  }
  return describeRoute({
    ...operation,
    tags: [tag],
    security,
    responses: { ...responses, ...operation.responses },
  })
}

export function documentationRoutes(app: Hono) {
  app.get(
    '/openapi.json',
    openAPIRouteHandler(app, {
      documentation: {
        openapi: '3.1.0',
        info: {
          title: 'Events and notifications API',
          version: '1.0.0',
          description:
            'Create events, reserve seats and manage a notification inbox. Identifiers are lowercase UUID v7 values. Dates use ISO 8601 with a timezone. Call POST /user/auth with a seeded userId, then use the returned bearer token. This is fake authentication, not proof of identity.',
        },
        tags: [
          { name: 'Identity', description: 'Create and revoke demo sessions.' },
          { name: 'Events', description: 'Browse, create and update events.' },
          {
            name: 'Reservations',
            description: 'Reserve seats, cancel and list your reservations.',
          },
          {
            name: 'Notifications',
            description:
              'Read your inbox and manage delivery preferences. The demo user must be enrolled as a notification recipient.',
          },
        ],
        components: {
          securitySchemes: {
            BearerSession: {
              type: 'http',
              scheme: 'bearer',
              description:
                'Create a session with POST /user/auth using userId 01900000-0000-7000-8000-000000000001. Paste only the returned token here, without the Bearer prefix. Fake authentication for local demos only.',
            },
          },
        },
      },
      exclude: ['/openapi.json', '/docs'],
    }),
  )
  app.get('/docs', Scalar({ url: '/openapi.json' }))
}
