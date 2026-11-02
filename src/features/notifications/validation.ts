import * as v from 'valibot'

// Notifications owns its HTTP identifiers independently of Events.
export const notificationIdSchema = v.pipe(
  v.string(),
  v.regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    'Expected a lowercase UUID v7',
  ),
)
export const bookingUserRefSchema = notificationIdSchema
export const preferencesSchema = v.config(
  v.message(
    v.strictObject({ inboxEnabled: v.boolean() }),
    'Expected inboxEnabled boolean only',
  ),
  { abortEarly: true },
)
