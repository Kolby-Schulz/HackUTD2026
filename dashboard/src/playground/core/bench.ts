// No-op stub wired into window.board; a real benchmark lands later.
export function bench(..._args: unknown[]): { ok: false; note: string } {
  return { ok: false, note: 'bench is not implemented yet' };
}
