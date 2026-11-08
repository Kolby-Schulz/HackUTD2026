// No-op stub wired into window.board; a real perf panel hook lands later.
export function perf(..._args: unknown[]): { ok: false; note: string } {
  return { ok: false, note: 'perf is not implemented yet' };
}
