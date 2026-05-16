export function uid(prefix = 'id'): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export class RingBuffer<T> {
  private values: T[] = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error('RingBuffer limit must be a positive integer');
    }
  }

  push(value: T): void {
    this.values.push(value);
    if (this.values.length > this.limit) {
      this.values.splice(0, this.values.length - this.limit);
    }
  }

  toArray(): T[] {
    return [...this.values];
  }

  drain(): T[] {
    const out = this.values;
    this.values = [];
    return out;
  }

  clear(): void {
    this.values = [];
  }

  get length(): number {
    return this.values.length;
  }
}
