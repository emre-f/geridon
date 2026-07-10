export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) {
      this.state = 0x9e3779b9;
    }
  }

  next(): number {
    this.state += 0x6d2b79f5;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInRange(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  nextInt(minInclusive: number, maxInclusive: number): number {
    return Math.min(
      maxInclusive,
      Math.floor(this.nextInRange(minInclusive, maxInclusive + 1)),
    );
  }

  pick<T>(items: T[]): T {
    return items[this.nextInt(0, items.length - 1)];
  }

  nextBoolean(probabilityTrue = 0.5): boolean {
    return this.next() < probabilityTrue;
  }

  nextGaussian(mean = 0, standardDeviation = 1): number {
    const u = Math.max(this.next(), Number.EPSILON);
    const v = this.next();
    const standardNormal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + standardDeviation * standardNormal;
  }

  fork(): SeededRandom {
    return new SeededRandom(Math.floor(this.next() * 4294967296));
  }
}
