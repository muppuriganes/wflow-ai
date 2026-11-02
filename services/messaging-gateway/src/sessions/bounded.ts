/** Insertion-ordered set that forgets its oldest entries beyond `limit`. */
export class BoundedSet {
  private readonly items = new Set<string>();
  constructor(private readonly limit: number) {}

  has(key: string): boolean {
    return this.items.has(key);
  }

  add(key: string): void {
    this.items.add(key);
    if (this.items.size > this.limit) {
      const oldest = this.items.values().next().value;
      if (oldest !== undefined) this.items.delete(oldest);
    }
  }
}

export class BoundedMap<V> {
  private readonly items = new Map<string, V>();
  constructor(private readonly limit: number) {}

  get(key: string): V | undefined {
    return this.items.get(key);
  }

  set(key: string, value: V): void {
    this.items.set(key, value);
    if (this.items.size > this.limit) {
      const oldest = this.items.keys().next().value;
      if (oldest !== undefined) this.items.delete(oldest);
    }
  }
}
