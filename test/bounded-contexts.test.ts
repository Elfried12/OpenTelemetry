import { expect, test } from 'bun:test'

test('shared kernel does not depend on a feature or infrastructure', async () => {
  const glob = new Bun.Glob('**/*.ts')
  for await (const file of glob.scan('src/shared-kernel')) {
    const source = await Bun.file(`src/shared-kernel/${file}`).text()
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      (match) => match[1]!,
    )
    for (const dependency of imports) {
      expect(dependency).not.toContain('/features/')
      expect(dependency).not.toContain('/infrastructure/')
    }
  }
})

// Keep the lesson's dependency rule executable as files move and features grow.
test('contexts share only published contracts, never domain models or repositories', async () => {
  const glob = new Bun.Glob('**/*.ts')
  for await (const file of glob.scan('src/features')) {
    const source = await Bun.file(`src/features/${file}`).text()
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      (match) => match[1]!,
    )
    for (const dependency of imports) {
      if (file.startsWith('events/')) {
        expect(dependency).not.toContain('/features/notifications/')
      }
      if (
        file.startsWith('notifications/') &&
        dependency.includes('/features/events/')
      ) {
        expect(file).toBe('notifications/infrastructure/events-subscriber.ts')
        expect(dependency).toBe('#/features/events/contracts/events.ts')
      }
      if (file.startsWith('events/contracts/')) {
        expect(dependency).not.toContain('/domain/')
      }
    }
  }
})
