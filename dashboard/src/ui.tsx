// Small shared pieces: event icons, avatars, status chips.
import { Component, type CSSProperties, type ReactNode } from 'react';
import type { Kind, Person } from './model.ts';

export const KIND_COLOR: Record<Kind, string> = {
  plan: 'var(--accent)', claim: 'var(--text2)', change: 'var(--warn)', edit: 'var(--accent)', conflict: 'var(--danger)', decision: 'var(--ok)', instruction: 'var(--done)',
};
export const KIND_WORD: Record<Kind, string> = { plan: 'Plan', claim: 'Claim', change: 'Change', edit: 'Edit', conflict: 'Conflict', decision: 'Decision', instruction: 'Push' };

const PATH: Record<Kind | 'all', string> = {
  plan: 'M6 4h8M6 8h8M6 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
  claim: 'M4 7h8v7H4z M5.5 7V5a2.5 2.5 0 0 1 5 0v2',
  change: 'M11 2.5l2.5 2.5L6 12.5H3.5V10z',
  edit: 'M5 4L1.5 8 5 12 M11 4l3.5 4-3.5 4',
  conflict: 'M8 2L14.5 13.5h-13z M8 6.5v3 M8 11.5h.01',
  decision: 'M14.25 8a6.25 6.25 0 1 1-12.5 0a6.25 6.25 0 1 1 12.5 0z M5.5 8.2l1.7 1.7 3.3-3.6',
  instruction: 'M2.5 8h10 M9 4.5L12.5 8 9 11.5',
  all: 'M2.5 4h11M4.5 8h7M6.5 12h3',
};

export function Icon({ kind, color, size = 14, width = 1.8 }: { kind: Kind | 'all'; color?: string; size?: number; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style={{ flex: 'none' }}>
      <path d={PATH[kind]} fill="none" stroke={color ?? (kind === 'all' ? 'currentColor' : KIND_COLOR[kind])} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Avatar({ p, size = 24, style }: { p: Person; size?: number; style?: CSSProperties }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: p.color, fontSize: Math.round(size * 0.45), ...style }} aria-hidden="true">
      {p.letter}
    </span>
  );
}

export const STATUS_COLOR: Record<string, [string, string]> = {
  Working: ['var(--ok)', 'var(--ok-soft)'],
  Paused: ['var(--warn)', 'var(--warn-soft)'],
  Done: ['var(--done)', 'var(--done-soft)'],
  Idle: ['var(--text2)', 'var(--soft)'],
  Resolved: ['var(--ok)', 'var(--ok-soft)'],
  Dismissed: ['var(--text2)', 'var(--soft)'],
  Open: ['var(--warn)', 'var(--warn-soft)'],
  'Coordinator resolving': ['var(--warn)', 'var(--warn-soft)'],
};

export function StatusLabel({ status, dot = true }: { status: string; dot?: boolean }) {
  const [fg, bg] = STATUS_COLOR[status] ?? STATUS_COLOR.Idle;
  return (
    <span className="label" style={{ color: fg, background: bg, borderColor: `color-mix(in srgb, ${fg} 30%, transparent)` }}>
      {dot && <span className="dot" style={{ background: fg }} />}
      {status}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>{children}</div>;
}

/** Keeps one crashing pane from blanking the whole workbench. */
export class Boundary extends Component<{ name: string; children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) return <div className="boundary" role="alert">{this.props.name} hit an error and was hidden: {this.state.error.message}</div>;
    return this.props.children;
  }
}
