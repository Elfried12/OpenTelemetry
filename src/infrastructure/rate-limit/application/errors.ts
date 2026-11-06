export class RateLimitUnavailable extends Error {
  constructor(cause: unknown) {
    super('Rate limiting is temporarily unavailable', { cause })
    this.name = 'RateLimitUnavailable'
  }
}
