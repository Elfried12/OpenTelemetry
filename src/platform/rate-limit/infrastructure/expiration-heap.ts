/** One heap entry per live bucket. Updating a deadline never leaves stale entries. */
export class ExpirationHeap<Key> {
  private readonly entries: { key: Key; expiresAt: number }[] = []
  private readonly positions = new Map<Key, number>()

  get size(): number {
    return this.entries.length
  }

  set(key: Key, expiresAt: number): void {
    const position = this.positions.get(key)
    if (position === undefined) {
      const index = this.entries.length
      this.entries.push({ key, expiresAt })
      this.positions.set(key, index)
      this.up(index)
      return
    }
    const previous = this.entries[position]!.expiresAt
    this.entries[position]!.expiresAt = expiresAt
    if (expiresAt < previous) {
      this.up(position)
    } else {
      this.down(position)
    }
  }

  popExpired(now: number): Key | undefined {
    const first = this.entries[0]
    if (!first || first.expiresAt > now) {
      return undefined
    }
    const last = this.entries.pop()!
    this.positions.delete(first.key)
    if (this.entries.length > 0) {
      this.entries[0] = last
      this.positions.set(last.key, 0)
      this.down(0)
    }
    return first.key
  }

  private swap(a: number, b: number): void {
    const first = this.entries[a]!
    const second = this.entries[b]!
    this.entries[a] = second
    this.entries[b] = first
    this.positions.set(second.key, a)
    this.positions.set(first.key, b)
  }

  private up(start: number): void {
    let index = start
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.entries[parent]!.expiresAt <= this.entries[index]!.expiresAt) {
        break
      }
      this.swap(index, parent)
      index = parent
    }
  }

  private down(start: number): void {
    let index = start
    while (true) {
      const left = index * 2 + 1
      if (left >= this.entries.length) {
        return
      }
      const right = left + 1
      let smallest = left
      if (
        right < this.entries.length &&
        this.entries[right]!.expiresAt < this.entries[left]!.expiresAt
      ) {
        smallest = right
      }
      if (this.entries[index]!.expiresAt <= this.entries[smallest]!.expiresAt) {
        return
      }
      this.swap(index, smallest)
      index = smallest
    }
  }
}
