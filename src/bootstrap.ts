import * as v from 'valibot'
import { getConnInfo } from 'hono/bun'
import { Duration } from '#/shared-kernel/duration.ts'
import { tokenBucket } from '#/infrastructure/rate-limit/bucket-strategies.ts'
import {
  rateLimitByUserId,
  type RateLimitConfig,
} from '#/infrastructure/rate-limit/rate-limit-middleware.ts'
import { PostgresIdentityRepository } from '#/features/identity/infrastructure/postgres-identity-repository.ts'
import { createContainer } from '#/composition-root.ts'
import { createPersistence } from '#/features/events/infrastructure/persistence.ts'
import { TOKEN } from '#/infrastructure/di/tokens.ts'
import { RedisClient, SQL } from 'bun'
import { ValkeyEventReadRepository } from '#/features/events/infrastructure/repository/valkey-event-read-repository.ts'
import { PostgresNotificationRepository } from '#/features/notifications/infrastructure/postgres-notification-repository.ts'

const applicationSecretKey = v.parse(
  v.pipe(
    v.string('APPLICATION_SECRET_KEY is required'),
    v.minLength(
      32,
      'APPLICATION_SECRET_KEY must contain at least 32 characters',
    ),
  ),
  process.env.APPLICATION_SECRET_KEY,
)

const persistence = createPersistence(
  process.env.EVENT_REPOSITORY ?? 'postgres',
)
// Identity and Notifications share a connection but query separate schemas.
const notificationSql = new SQL(
  process.env.DATABASE_URL ?? 'postgres://events:events@localhost:55432/events',
)
const readModelClient = new RedisClient(
  process.env.VALKEY_URL ?? 'redis://localhost:56379',
)
const readRepository = new ValkeyEventReadRepository(readModelClient)
// Load all stored events into the read model before accepting requests.
await readRepository.replaceEvents(await persistence.repository.listEvents({}))
const rateLimitConfig: RateLimitConfig = {
  key: rateLimitByUserId((c) => getConnInfo(c).remote.address),
  bucket: tokenBucket(100, Duration.makeUnsafe(60_000)),
}
const container = createContainer({
  applicationSecretKey,
  rateLimitConfig,
  repository: persistence.repository,
  identityRepository: new PostgresIdentityRepository(notificationSql),
  readRepository,
  notificationRepository: new PostgresNotificationRepository(notificationSql),
})
const app = container.resolve(TOKEN.App)
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
})
console.log(`Events API listening on ${server.url}`)

async function shutdown() {
  await server.stop()
  container.resolve(TOKEN.NotificationSubscription)()
  container.resolve(TOKEN.EventReadModelSubscription)()
  readModelClient.close()
  await persistence.close()
  await notificationSql.close()
  process.exit(0)
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
