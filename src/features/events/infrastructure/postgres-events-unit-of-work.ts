import type { SQL } from 'bun'
import type {
  ApplicationError,
  EventRepository,
  EventsUnitOfWork,
  OutboxWriter,
} from '#/features/events/application/ports.ts'
import type { DomainEvent } from '#/features/events/contracts/events.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'
import { Result, type Failure } from '#/shared-kernel/result.ts'
import { PostgresEventRepository } from './repository/postgres-event-repository.ts'

// A normal return from Bun's transaction callback commits, including a Failure.
// This private signal forces rollback without exposing business failures as throws.
class RollbackResult {
  constructor(readonly result: Failure<ApplicationError>) {}
}

export class PostgresOutboxWriter implements OutboxWriter {
  constructor(private readonly tx: SQL) {}

  async append(envelope: EventEnvelope<DomainEvent>): Promise<void> {
    await this.tx`INSERT INTO events.outbox (message_id, envelope)
      VALUES (${envelope.messageId}, ${envelope}::jsonb)`
  }
}

export class PostgresEventsUnitOfWork implements EventsUnitOfWork {
  constructor(private readonly sql: SQL) {}

  async run<Value>(
    work: (scope: {
      events: EventRepository
      outbox: OutboxWriter
    }) => Promise<Result<Value, ApplicationError>>,
  ): Promise<Result<Value, ApplicationError>> {
    try {
      return await this.sql.begin(async (tx) => {
        const result = await work({
          events: new PostgresEventRepository(tx, true),
          outbox: new PostgresOutboxWriter(tx),
        })
        if (Result.isFailure(result)) {
          throw new RollbackResult(result)
        }
        return result
      })
    } catch (cause) {
      if (cause instanceof RollbackResult) {
        return cause.result
      }
      throw cause
    }
  }
}
