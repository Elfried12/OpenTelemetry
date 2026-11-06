declare const tokenType: unique symbol

export interface Token<Service> {
  readonly key: symbol
  readonly description: string
  readonly [tokenType]?: Service
}

export const createToken = <Service>(description: string): Token<Service> => ({
  key: Symbol(description),
  description,
})
