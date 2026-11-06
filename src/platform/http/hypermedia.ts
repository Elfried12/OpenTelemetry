import * as v from 'valibot'

type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PATCH'
  | 'PUT'
  | 'DELETE'
  | 'OPTION'
  | 'HEAD'
  | 'QUERY'

// A small application/json link format, not HAL.
export function linkSchema(method: HttpMethod) {
  return v.strictObject({
    href: v.pipe(v.string(), v.startsWith('/')),
    method: v.literal(method),
  })
}
