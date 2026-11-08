import { add } from './lib/math.js';

export async function handle(req) {
  return add(req.a, req.b);
}
