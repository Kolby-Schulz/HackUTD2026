// A textarea with `@Name` autocomplete (COMMENT-8). Controlled; Arrow keys move, Enter/Tab pick, Escape closes the list.
import { useRef, useState } from 'react';
import type { KeyboardEvent, Ref } from 'react';
import { applyMention, mentionQuery, suggestMentions } from '../../agents/router';
import type { RouterAgent } from '../../agents/router';

type Props = {
  value: string;
  onChange: (v: string) => void;
  agents: RouterAgent[];
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  inputRef?: Ref<HTMLTextAreaElement>;
  name?: string; rows?: number; placeholder?: string;
};

export function MentionTextarea({ value, onChange, agents, onKeyDown, inputRef, ...rest }: Props) {
  const el = useRef<HTMLTextAreaElement | null>(null);
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const q = mentionQuery(value, caret);
  const rows = q && closedAt !== value ? suggestMentions(q.query, agents, { includeStopped: true }) : [];
  const open = rows.length > 0;
  const idx = Math.min(pick, Math.max(rows.length - 1, 0));

  const choose = (name: string) => {
    if (!q) return;
    const r = applyMention(value, q.start, caret, name);
    onChange(r.text);
    setCaret(r.caret);
    requestAnimationFrame(() => { el.current?.focus(); el.current?.setSelectionRange(r.caret, r.caret); });
  };
  const sync = (t: HTMLTextAreaElement) => setCaret(t.selectionStart ?? t.value.length);

  return (
    <>
      {open && (
        <ul className="pg-mention" role="listbox" aria-label="Mention an agent">
          {rows.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === idx} className={i === idx ? 'on' : ''}
              onMouseDown={(e) => { e.preventDefault(); choose(s.name); }}>
              <b>@{s.name}</b>{s.role && <small>{s.role}</small>}{s.stopped && <small>stopped</small>}
            </li>
          ))}
        </ul>
      )}
      <textarea {...rest} value={value}
        ref={(n) => { el.current = n; if (typeof inputRef === 'function') inputRef(n); else if (inputRef) (inputRef as { current: HTMLTextAreaElement | null }).current = n; }}
        onChange={(e) => { onChange(e.target.value); sync(e.target); setPick(0); }}
        onKeyUp={(e) => sync(e.currentTarget)}
        onClick={(e) => sync(e.currentTarget)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setPick((idx + 1) % rows.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setPick((idx - 1 + rows.length) % rows.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(rows[idx].name); return; }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setClosedAt(value); return; }
          }
          onKeyDown?.(e);
        }} />
    </>
  );
}
