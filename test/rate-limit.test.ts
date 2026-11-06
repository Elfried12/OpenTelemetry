import { expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { Hono, type Context } from 'hono'
import {
  fixedWindow,
  slidingWindow,
  tokenBucket,
  leakyBucket,
} from '#/platform/rate-limit/domain/bucket-strategies.ts'
import type { BucketStrategy } from '#/platform/rate-limit/application/ports.ts'
import { InMemoryRateLimitRepository } from '#/platform/rate-limit/infrastructure/in-memory-rate-limit-repository.ts'
import {
  rateLimitMiddleware,
  rateLimitByIp,
  rateLimitByUserId,
  rateLimitBySession,
} from '#/platform/rate-limit/http/rate-limit-middleware.ts'
import { SessionService } from '#/features/identity/application/session-service.ts'
import { InMemoryIdentityRepository } from '#/features/identity/infrastructure/in-memory-identity-repository.ts'
import { sessionMiddleware } from '#/features/identity/routes/session-middleware.ts'
import { createContainer } from '#/composition-root.ts'
import { TOKEN } from '#/platform/di/tokens.ts'
import { Duration } from '#/shared-kernel/duration.ts'
import {
  InvalidRateLimitConfiguration,
  RateLimitExceeded,
} from '#/platform/rate-limit/domain/errors.ts'
import { RateLimiter } from '#/platform/rate-limit/application/rate-limiter.ts'
import { RateLimitUnavailable } from '#/platform/rate-limit/application/errors.ts'
import { anApplication } from './support/application-fixture.ts'
import { given } from './support/given.ts'

const oneSecond = Duration.makeUnsafe(1_000)
const fourSeconds = Duration.makeUnsafe(4_000)
const algorithms = [
  {
    name: 'fixed window',
    create: fixedWindow,
    firstResetSeconds: '4',
    retrySeconds: '4',
  },
  {
    name: 'sliding window',
    create: slidingWindow,
    firstResetSeconds: '4',
    retrySeconds: '4',
  },
  {
    name: 'token bucket',
    create: tokenBucket,
    firstResetSeconds: '2',
    retrySeconds: '2',
  },
  {
    name: 'leaky bucket',
    create: leakyBucket,
    firstResetSeconds: '2',
    retrySeconds: '2',
  },
]

function aBucket(bucket: BucketStrategy) {
  return { repository: new InMemoryRateLimitRepository(), bucket }
}

test.each(algorithms)(
  '$name enforces capacity, isolates clients, and recovers after idle',
  ({ create }) =>
    given(() => aBucket(create(2, oneSecond)))
      .when(async ({ repository, bucket }) => {
        const first = await repository.consume('alice', bucket, 0)
        const second = await repository.consume('alice', bucket, 0)
        const denied = await repository.consume('alice', bucket, 0)
        const otherClient = await repository.consume('bob', bucket, 0)
        const recovered = await repository.consume('alice', bucket, 2000)
        return { first, second, denied, otherClient, recovered }
      })
      .then(({ first, second, denied, otherClient, recovered }) => {
        expect(first).toMatchObject({
          allowed: true,
          remaining: 1,
          retryAfter: Duration.zero,
        })
        expect(second).toMatchObject({ allowed: true, remaining: 0 })
        expect(denied).toMatchObject({ allowed: false, remaining: 0 })
        expect(otherClient.allowed).toBe(true)
        expect(recovered).toMatchObject({ allowed: true, remaining: 1 })
      }),
)

test.each(algorithms)('$name rejects invalid configuration', ({ create }) =>
  given(() => ({ create, invalidCapacities: [0, -1, NaN, Infinity, 1.5] }))
    .when(({ create, invalidCapacities }) => ({
      invalidFactories: invalidCapacities.map(
        (capacity) => () => create(capacity, oneSecond),
      ),
      zeroPeriodFactory: () => create(1, Duration.zero),
    }))
    .then(({ invalidFactories, zeroPeriodFactory }) => {
      for (const factory of invalidFactories) {
        expect(factory).toThrow(InvalidRateLimitConfiguration)
      }
      expect(zeroPeriodFactory).toThrow(InvalidRateLimitConfiguration)
    }),
)

test.each(algorithms)(
  '$name atomically enforces a limit under concurrent requests',
  ({ create }) =>
    given(() => aBucket(create(5, oneSecond)))
      .when(({ repository, bucket }) =>
        Promise.all(
          Array.from({ length: 50 }, () =>
            repository.consume('alice', bucket, 0),
          ),
        ),
      )
      .then((results) => {
        expect(results.filter((result) => result.allowed)).toHaveLength(5)
        expect(results.filter((result) => !result.allowed)).toHaveLength(45)
      }),
)

test.each([
  {
    name: 'fixed window',
    create: fixedWindow,
    allowedAtBoundary: true,
    recoveryTime: 2000,
  },
  {
    name: 'sliding window',
    create: slidingWindow,
    allowedAtBoundary: false,
    recoveryTime: 1999,
  },
])(
  '$name has the expected boundary behavior',
  ({ create, allowedAtBoundary, recoveryTime }) =>
    given(async () => {
      const fixture = aBucket(create(1, oneSecond))
      await fixture.repository.consume('alice', fixture.bucket, 999)
      return fixture
    })
      .when(async ({ repository, bucket }) => {
        const atBoundary = await repository.consume('alice', bucket, 1000)
        const recovered = await repository.consume(
          'alice',
          bucket,
          recoveryTime,
        )
        return { atBoundary, recovered }
      })
      .then(({ atBoundary, recovered }) => {
        expect(atBoundary.allowed).toBe(allowedAtBoundary)
        expect(recovered.allowed).toBe(true)
      }),
)

test.each([
  { name: 'token bucket', create: tokenBucket },
  { name: 'leaky bucket', create: leakyBucket },
])(
  '$name recovers one slot continuously without resetting on rejection',
  ({ create }) =>
    given(async () => {
      const fixture = aBucket(create(2, oneSecond))
      await fixture.repository.consume('alice', fixture.bucket, 0)
      await fixture.repository.consume('alice', fixture.bucket, 0)
      return fixture
    })
      .when(async ({ repository, bucket }) => {
        const halfway = await repository.consume('alice', bucket, 250)
        const beforeRecovery = await repository.consume('alice', bucket, 499)
        const recovered = await repository.consume('alice', bucket, 500)
        return { halfway, beforeRecovery, recovered }
      })
      .then(({ halfway, beforeRecovery, recovered }) => {
        expect(halfway).toMatchObject({
          allowed: false,
          retryAfter: Duration.makeUnsafe(250),
        })
        expect(beforeRecovery).toMatchObject({
          allowed: false,
          retryAfter: Duration.makeUnsafe(1),
        })
        expect(recovered.allowed).toBe(true)
      }),
)

test('sliding windows expire individual timestamps and do not record denied requests', () =>
  given(async () => {
    const fixture = aBucket(slidingWindow(2, oneSecond))
    await fixture.repository.consume('alice', fixture.bucket, 0)
    await fixture.repository.consume('alice', fixture.bucket, 500)
    return fixture
  })
    .when(async ({ repository, bucket }) => {
      const denied = await repository.consume('alice', bucket, 900)
      const accepted = await repository.consume('alice', bucket, 1000)
      const deniedAgain = await repository.consume('alice', bucket, 1000)
      return { denied, accepted, deniedAgain }
    })
    .then(({ denied, accepted, deniedAgain }) => {
      expect(denied).toMatchObject({
        allowed: false,
        retryAfter: Duration.makeUnsafe(100),
      })
      expect(accepted.allowed).toBe(true)
      expect(deniedAgain).toMatchObject({
        allowed: false,
        retryAfter: Duration.makeUnsafe(500),
      })
    }))

test('different policies do not share state in one repository', () =>
  given(async () => {
    const repository = new InMemoryRateLimitRepository()
    await repository.consume('alice', fixedWindow(1, oneSecond), 0)
    return repository
  })
    .when(async (repository) => {
      const differentCapacity = await repository.consume(
        'alice',
        fixedWindow(2, oneSecond),
        0,
      )
      const differentAlgorithm = await repository.consume(
        'alice',
        slidingWindow(1, oneSecond),
        0,
      )
      return { differentCapacity, differentAlgorithm }
    })
    .then(({ differentCapacity, differentAlgorithm }) => {
      expect(differentCapacity).toMatchObject({ allowed: true, remaining: 1 })
      expect(differentAlgorithm.allowed).toBe(true)
    }))

// Only tests use a request header for IPs. Production uses the socket address.
const resolveIp = (c: Context) => c.req.header('Test-IP')
const identities = [
  {
    name: 'IP',
    strategy: rateLimitByIp,
    otherSessionStatus: 429,
    otherUserStatus: 429,
    otherIpStatus: 200,
  },
  {
    name: 'user ID',
    strategy: rateLimitByUserId,
    otherSessionStatus: 429,
    otherUserStatus: 200,
    otherIpStatus: 429,
  },
  {
    name: 'session',
    strategy: rateLimitBySession,
    otherSessionStatus: 200,
    otherUserStatus: 200,
    otherIpStatus: 429,
  },
]
const ipAddresses = [
  { family: 'IPv4', ip: '127.0.0.1', otherIp: '127.0.0.2' },
  { family: 'IPv6', ip: '::1', otherIp: '2001:db8::1' },
]
const identityCases = identities.flatMap((identity) =>
  ipAddresses.map((addresses) => ({ ...identity, ...addresses })),
)

async function authenticatedApp(
  keyStrategy: typeof rateLimitByIp,
  defaultIp = '127.0.0.1',
) {
  const sessions = new SessionService(
    new InMemoryIdentityRepository(new Set(['alice', 'bob'])),
    'test-secret',
  )
  const first = await sessions.create('alice')
  const second = await sessions.create('alice')
  const bob = await sessions.create('bob')
  if (!first || !second || !bob) {
    throw new Error('Missing test session')
  }
  let now = 0
  const app = new Hono()
  app.use('*', sessionMiddleware(sessions))
  app.use(
    '*',
    rateLimitMiddleware(
      { key: keyStrategy(resolveIp), bucket: fixedWindow(1, oneSecond) },
      () => new Date(now),
    ),
  )
  app.get('*', (c) => c.json({ ok: true }))
  const request = ({
    token,
    ip = defaultIp,
  }: { token?: string; ip?: string } = {}) => {
    const headers = new Headers({ 'Test-IP': ip })
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    return app.request('/events', { headers })
  }
  return {
    request,
    first,
    second,
    bob,
    advance: () => {
      now = oneSecond.milliseconds
    },
  }
}

test.each(identityCases)(
  '$name / $family returns 429, quota headers and recovers with the clock',
  ({ strategy, ip }) =>
    given(() => authenticatedApp(strategy, ip))
      .when(async ({ request, first, advance }) => {
        const allowed = await request({ token: first.token })
        const denied = await request({ token: first.token })
        const body = await denied.json()
        advance()
        const recovered = await request({ token: first.token })
        return { allowed, denied, body, recovered }
      })
      .then(({ allowed, denied, body, recovered }) => {
        expect(allowed.status).toBe(200)
        expect(allowed.headers.get('X-RateLimit-Remaining')).toBe('0')
        expect(denied.status).toBe(429)
        expect(denied.headers.get('Retry-After')).toBe('1')
        expect(denied.headers.get('X-RateLimit-Limit')).toBe('1')
        expect(denied.headers.get('X-RateLimit-Reset')).toBe('1')
        expect(denied.headers.get('X-RateLimit-Reset-After')).toBe('1')
        expect(body).toEqual({
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' },
        })
        expect(recovered.status).toBe(200)
      }),
)

test.each(identityCases)(
  '$name / $family groups identities as configured',
  ({
    strategy,
    ip,
    otherIp,
    otherSessionStatus,
    otherUserStatus,
    otherIpStatus,
  }) =>
    given(() => authenticatedApp(strategy, ip))
      .when(async ({ request, first, second, bob }) => {
        const initial = await request({ token: first.token })
        const otherSession = await request({ token: second.token })
        const otherUser = await request({ token: bob.token })
        const fromOtherIp = await request({ token: first.token, ip: otherIp })
        return { initial, otherSession, otherUser, fromOtherIp }
      })
      .then(({ initial, otherSession, otherUser, fromOtherIp }) => {
        expect(initial.status).toBe(200)
        expect(otherSession.status).toBe(otherSessionStatus)
        expect(otherUser.status).toBe(otherUserStatus)
        expect(fromOtherIp.status).toBe(otherIpStatus)
      }),
)

test.each(identityCases)(
  '$name / $family falls back to IP for anonymous requests',
  ({ strategy, ip, otherIp }) =>
    given(() => authenticatedApp(strategy, ip))
      .when(async ({ request }) => {
        const first = await request()
        const denied = await request()
        const otherClient = await request({ ip: otherIp })
        return { first, denied, otherClient }
      })
      .then(({ first, denied, otherClient }) => {
        expect(first.status).toBe(200)
        expect(denied.status).toBe(429)
        expect(otherClient.status).toBe(200)
      }),
)

test('untrusted credentials cannot select or consume a user bucket', () =>
  given(() => authenticatedApp(rateLimitByUserId))
    .when(async ({ request, first }) => {
      const unauthorized = await request({ token: 'invalid' })
      const authorized = await request({ token: first.token })
      return { unauthorized, authorized }
    })
    .then(({ unauthorized, authorized }) => {
      expect(unauthorized.status).toBe(401)
      expect(authorized.status).toBe(200)
    }))

test('composition root configures rate limiting for all routes', () =>
  given(() => {
    const fixture = anApplication()
    const rateLimitConfig = {
      key: rateLimitByIp(() => '127.0.0.1'),
      bucket: fixedWindow(1, oneSecond),
    }
    const container = createContainer({
      applicationSecretKey: 'test-application-secret-key-not-for-production',
      repository: fixture.repository,
      clock: { now: () => new Date(0) },
      rateLimitConfig,
    })
    return container.resolve(TOKEN.App)
  })
    .when(async (app) => {
      const events = await app.request('/events')
      const docs = await app.request('/docs')
      const login = await app.request('/user/auth', { method: 'POST' })
      const notifications = await app.request('/notifications')
      return { events, docs, login, notifications }
    })
    .then(({ events, docs, login, notifications }) => {
      expect(events.status).toBe(200)
      expect(docs.status).toBe(429)
      expect(login.status).toBe(429)
      expect(notifications.status).toBe(429)
    }))

test('omitting rateLimitConfig leaves the application unlimited', () =>
  given(() => anApplication().container.resolve(TOKEN.App))
    .when(async (app) => {
      const first = await app.request('/events')
      const second = await app.request('/events')
      return { first, second }
    })
    .then(({ first, second }) => {
      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(first.headers.get('X-RateLimit-Limit')).toBeNull()
      expect(second.headers.get('X-RateLimit-Limit')).toBeNull()
    }))

test('application returns a domain error with retry and quota information', () =>
  given(async () => {
    const limiter = new RateLimiter(
      new InMemoryRateLimitRepository(),
      tokenBucket(2, oneSecond),
      () => new Date(0),
    )
    await limiter.consume('alice')
    await limiter.consume('alice')
    return limiter
  })
    .when((limiter) => limiter.consume('alice'))
    .then((result) => {
      assert(
        result._tag === 'Failure',
        'Expected a rejected rate limit decision',
      )
      assert(result.error instanceof RateLimitExceeded)
      expect(result.error.retryAfter.equals(Duration.makeUnsafe(500))).toBe(
        true,
      )
      expect(result.error.quota).toEqual({
        limit: 2,
        remaining: 0,
        resetAt: 1000,
      })
    }))

test.each(algorithms)(
  '$name exposes full quota recovery separately from the next slot',
  ({ create, firstResetSeconds, retrySeconds }) =>
    given(() => {
      let timestamp = 0
      const app = new Hono()
      app.use(
        '*',
        rateLimitMiddleware(
          { key: () => 'alice', bucket: create(2, fourSeconds) },
          () => new Date(timestamp),
        ),
      )
      app.get('/', (c) => c.text('ok'))
      return {
        app,
        advance: () => {
          timestamp = 500
        },
      }
    })
      .when(async ({ app, advance }) => {
        const first = await app.request('/')
        const second = await app.request('/')
        advance()
        const denied = await app.request('/')
        return { first, second, denied }
      })
      .then(({ first, second, denied }) => {
        expect(first.status).toBe(200)
        expect(first.headers.get('Retry-After')).toBeNull()
        expect(first.headers.get('X-RateLimit-Reset')).toBe(firstResetSeconds)
        expect(first.headers.get('X-RateLimit-Reset-After')).toBe(
          firstResetSeconds,
        )
        expect(second.status).toBe(200)
        expect(denied.status).toBe(429)
        expect(denied.headers.get('X-RateLimit-Reset')).toBe('4')
        expect(denied.headers.get('X-RateLimit-Reset-After')).toBe('4')
        expect(denied.headers.get('Retry-After')).toBe(retrySeconds)
      }),
)

test('sliding-window reset follows the newest accepted request, retry follows the oldest', () =>
  given(async () => {
    const fixture = aBucket(slidingWindow(2, fourSeconds))
    await fixture.repository.consume('alice', fixture.bucket, 0)
    await fixture.repository.consume('alice', fixture.bucket, 1000)
    return fixture
  })
    .when(({ repository, bucket }) => repository.consume('alice', bucket, 2000))
    .then((result) => {
      expect(result.allowed).toBe(false)
      expect(result.resetAt).toBe(5000)
      expect(result.retryAfter.milliseconds).toBe(2000)
    }))

test('repository failure becomes an application error and a fail-closed 503 response', () =>
  given(() => {
    const cause = new Error('Storage failed')
    const repository = {
      consume: async () => {
        throw cause
      },
    }
    const bucket = fixedWindow(1, oneSecond)
    const limiter = new RateLimiter(repository, bucket)
    const app = new Hono()
    let handled = false
    app.use(
      '*',
      rateLimitMiddleware({ key: () => 'alice', bucket, repository }),
    )
    app.get('/', (c) => {
      handled = true
      return c.text('ok')
    })
    return { cause, limiter, app, wasHandled: () => handled }
  })
    .when(async ({ limiter, app, wasHandled }) => {
      const result = await limiter.consume('alice')
      const response = await app.request('/')
      const body = await response.json()
      return { result, response, body, handled: wasHandled() }
    })
    .then(({ result, response, body, handled }, { cause }) => {
      assert(result._tag === 'Failure', 'Expected a rate limit storage failure')
      expect(result.error).toBeInstanceOf(RateLimitUnavailable)
      expect(result.error.cause).toBe(cause)
      expect(response.status).toBe(503)
      expect(handled).toBe(false)
      expect(body).toEqual({
        error: {
          code: 'RATE_LIMIT_UNAVAILABLE',
          message: 'Rate limiting is temporarily unavailable',
        },
      })
      expect(response.headers.get('X-RateLimit-Reset')).toBeNull()
    }))

test('nested repository maps isolate arbitrary policy and client strings without serialized keys', () =>
  given(() => {
    const repository = new InMemoryRateLimitRepository()
    const policy = fixedWindow(1, oneSecond)
    return {
      repository,
      firstPolicy: { ...policy, id: 'a:b' },
      secondPolicy: { ...policy, id: 'a' },
    }
  })
    .when(async ({ repository, firstPolicy, secondPolicy }) => {
      const first = await repository.consume('c', firstPolicy, 0)
      const second = await repository.consume('b:c', secondPolicy, 0)
      const denied = await repository.consume('c', firstPolicy, 0)
      repository.prune(1000)
      const recovered = await repository.consume('c', firstPolicy, 1000)
      return { first, second, denied, recovered }
    })
    .then(({ first, second, denied, recovered }) => {
      expect(first.allowed).toBe(true)
      expect(second.allowed).toBe(true)
      expect(denied.allowed).toBe(false)
      expect(recovered.allowed).toBe(true)
    }))
