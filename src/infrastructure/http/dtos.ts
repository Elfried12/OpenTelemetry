import * as v from 'valibot'

const nonEmptyText = v.pipe(
  v.string(),
  v.check((value) => value.trim().length > 0, 'Expected non-empty text'),
)

export const errorDtoSchema = v.strictObject({
  error: v.strictObject({
    code: nonEmptyText,
    message: nonEmptyText,
  }),
})
