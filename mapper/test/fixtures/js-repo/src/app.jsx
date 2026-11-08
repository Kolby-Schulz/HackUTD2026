import { Counter, double, SCALE } from './lib/math.js';

export function Total({ value }) {
  return <span>{double(value) * SCALE}</span>;
}

export function makeCounter() {
  return new Counter(1).inc();
}
