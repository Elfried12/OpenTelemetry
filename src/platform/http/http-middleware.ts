import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { createMiddleware } from 'hono/factory'
import { routePath } from 'hono/route'
import { log, meter, tracer } from '../observability/telemetry.js'

const duration = meter.createHistogram('http.server.request.duration', {
  unit: 's',
  advice: { explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5] },
})
const active = meter.createUpDownCounter('http.server.active_requests', { unit: '{request}' })
const headerGetter = {
  get: (h: Headers, k: string) => h.get(k) ?? undefined,
  keys: (h: Headers) => [...h.keys()],
}

export const httpTelemetry = createMiddleware(async (c, next) => {
  const method = c.req.method
  const parent = propagation.extract(context.active(), c.req.raw.headers, headerGetter) // B3 ou traceparent entrant
  const span = tracer.startSpan(method, {
    kind: SpanKind.SERVER,
    attributes: {
      'http.request.method': method,
      'url.path': c.req.path,
      'user_agent.original': c.req.header('user-agent'),
    },
  }, parent)
  active.add(1, { 'http.request.method': method })
  const start = performance.now()
  try {
    await context.with(trace.setSpan(parent, span), next)
  } finally {
    const route = routePath(c, -1) // '/events/:eventId' et non l'URL réelle → faible cardinalité
    const status = c.res.status
    span.updateName(`${method} ${route}`)
    span.setAttributes({ 'http.route': route, 'http.response.status_code': status })
    if (c.error) {
      span.recordException(c.error)
      log.error('Unhandled request error', c.error, { 'http.route': route })
    }
    const attrs: Record<string, string | number> = {
      'http.request.method': method, 'http.route': route, 'http.response.status_code': status,
    }
    if (status >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR })
      attrs['error.type'] = String(status)
    }
    c.header('X-Trace-Id', span.spanContext().traceId) // pour retrouver une requête dans le viewer
    duration.record((performance.now() - start) / 1000, attrs)
    active.add(-1, { 'http.request.method': method })
    span.end()
  }
})
