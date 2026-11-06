import { metrics, SpanStatusCode, trace, type Attributes, type Span, type SpanOptions } from '@opentelemetry/api'
import { logs, SeverityNumber } from '@opentelemetry/api-logs'

export const tracer = trace.getTracer('events-api')
export const meter = metrics.getMeter('events-api')
const logger = logs.getLogger('events-api')

const emit = (severityNumber: SeverityNumber, severityText: string) =>
  (body: string, attributes: Attributes = {}) =>
    logger.emit({ severityNumber, severityText, body, attributes }) // trace_id/span_id ajoutés automatiquement

export const log = {
  info: emit(SeverityNumber.INFO, 'INFO'),
  warn: emit(SeverityNumber.WARN, 'WARN'),
  error: (body: string, error: unknown, attributes: Attributes = {}) => {
    const e = error instanceof Error ? error : new Error(String(error))
    emit(SeverityNumber.ERROR, 'ERROR')(body, {
      ...attributes, 'exception.type': e.name, 'exception.message': e.message, 'exception.stacktrace': e.stack,
    })
  },
}

export function inSpan<T>(name: string, attributes: Attributes, work: (span: Span) => Promise<T>, options: SpanOptions = {}) {
  return tracer.startActiveSpan(name, { ...options, attributes }, async (span) => {
    try {
      return await work(span)
    } catch (error) {
      span.recordException(error as Error)
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw error
    } finally {
      span.end()
    }
  })
}

// Un Failure métier (Conflict, NotFound...) n'est pas une panne : on le note sans passer le span en ERROR.
export function outcomeOf(result: unknown): string {
  const r = result as { _tag?: string; error?: object }
  return r?._tag === 'Failure' ? (r.error?.constructor.name ?? 'Failure') : 'success'
}
