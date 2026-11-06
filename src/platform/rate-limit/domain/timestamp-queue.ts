interface Node {
  readonly value: number
  readonly next: Node | undefined
}

/** Persistent FIFO: old versions remain valid without copying the active window. */
export class TimestampQueue {
  private constructor(
    private readonly front: Node | undefined,
    private readonly back: Node | undefined,
    readonly size: number,
    readonly newest: number | undefined,
  ) {}

  static empty(): TimestampQueue {
    return new TimestampQueue(undefined, undefined, 0, undefined)
  }

  get oldest(): number | undefined {
    return this.front?.value
  }

  enqueue(value: number): TimestampQueue {
    if (!this.front) {
      return new TimestampQueue({ value, next: undefined }, undefined, 1, value)
    }
    return new TimestampQueue(
      this.front,
      { value, next: this.back },
      this.size + 1,
      value,
    )
  }

  dequeue(): TimestampQueue {
    if (!this.front) {
      return this
    }
    if (this.front.next) {
      return new TimestampQueue(
        this.front.next,
        this.back,
        this.size - 1,
        this.newest,
      )
    }
    // Reverse only when the front is exhausted. Each node moves once along
    // a linear consumption history, giving amortized O(1) queue operations.
    let front: Node | undefined
    let back = this.back
    while (back) {
      front = { value: back.value, next: front }
      back = back.next
    }
    return new TimestampQueue(
      front,
      undefined,
      this.size - 1,
      front ? this.newest : undefined,
    )
  }

  expireThrough(cutoff: number): TimestampQueue {
    if (!this.front || this.front.value > cutoff) {
      return this
    }
    let queue = this.dequeue()
    while (queue.front && queue.front.value <= cutoff) {
      queue = queue.dequeue()
    }
    return queue
  }
}
