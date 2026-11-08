// Plain JavaScript: no types, ES module exports.
export function add(a, b) {
  return a + b;
}

export const double = (x) => add(x, x);

export const SCALE = 10;

export class Counter {
  constructor(start = 0) {
    this.n = start;
  }

  inc() {
    this.n = add(this.n, 1);
    return this;
  }
}
