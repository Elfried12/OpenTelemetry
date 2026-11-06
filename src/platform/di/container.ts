import type { Token } from '#/platform/di/token.ts'

export abstract class ContainerError extends Error {
  protected constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class UnknownRegistrationError extends ContainerError {
  constructor(readonly tokenDescription: string) {
    super(`No registration for ${tokenDescription}`)
  }
}

export class CircularDependencyError extends ContainerError {
  constructor(readonly tokenDescription: string) {
    super(`Circular dependency while resolving ${tokenDescription}`)
  }
}

export class DuplicateRegistrationError extends ContainerError {
  constructor(readonly tokenDescription: string) {
    super(`Duplicate registration for ${tokenDescription}`)
  }
}

type Factory<Service> = (container: Container) => Service

interface Registration {
  readonly lifetime: 'singleton' | 'factory'
  readonly create: Factory<unknown>
  initialized: boolean
  instance?: unknown
}

export class Container {
  private readonly registrations = new Map<symbol, Registration>()
  private readonly resolving = new Set<symbol>()

  singleton<Service>(token: Token<Service>, create: Factory<Service>) {
    return this.register(token, 'singleton', create)
  }

  factory<Service>(token: Token<Service>, create: Factory<Service>) {
    return this.register(token, 'factory', create)
  }

  resolve<Service>(token: Token<Service>): Service {
    const service = this.registrations.get(token.key)
    if (service === undefined) {
      throw new UnknownRegistrationError(token.description)
    }

    if (this.resolving.has(token.key)) {
      throw new CircularDependencyError(token.description)
    }

    if (service.lifetime === 'singleton' && service.initialized) {
      return service.instance as Service
    }

    this.resolving.add(token.key)
    try {
      const instance = service.create(this) as Service
      if (service.lifetime === 'singleton') {
        service.instance = instance
        service.initialized = true
      }
      return instance
    } finally {
      this.resolving.delete(token.key)
    }
  }

  private register<Service>(
    token: Token<Service>,
    lifetime: Registration['lifetime'],
    create: Factory<Service>,
  ) {
    if (this.registrations.has(token.key)) {
      throw new DuplicateRegistrationError(token.description)
    }
    this.registrations.set(token.key, { lifetime, create, initialized: false })
    return this
  }
}
