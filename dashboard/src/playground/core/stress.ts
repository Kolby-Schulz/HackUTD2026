// No-op stub wired into window.board; a real stress driver lands later.
export function stress(..._args: unknown[]): { ok: false; note: string } {
  return { ok: false, note: 'stress is not implemented yet' };
}
