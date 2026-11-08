// In-place text editor (TEXT-2/3/13/14). A textarea overlaying the layer; typography is inherited from the
// parent so it matches the rendered text at any zoom. Enter inserts a newline; Esc, Cmd/Ctrl+Enter or
// click-away commits. `data-pg-ctx="text-edit"` stops canvas shortcuts (core/keys.ts). Paste is plain text.
// An open gesture holds the soft lock on the layer while typing; the commit is one `exec` = one undo entry.
import { useEffect, useRef } from 'react';
import type { Shape } from '../../core/types';
import { useBoardEnv } from '../board/context';
import { commitText } from '../gestures/text';
import '../../styles/text.css';

export const MAX_PASTE_CHARS = 100_000;
const KEEPALIVE_MS = 1500; // soft-lock TTL is 4 s: refresh while the editor is open

/** Clipboard text -> editor text: plain, "\n" newlines, capped at 100k chars. */
export function normalizePaste(raw: string): { text: string; truncated: boolean } {
  const text = raw.replace(/\r\n?/g, '\n');
  return text.length > MAX_PASTE_CHARS ? { text: text.slice(0, MAX_PASTE_CHARS), truncated: true } : { text, truncated: false };
}

export function TextEditor({ shape }: { shape: Shape }) {
  const env = useBoardEnv();
  const id = shape.id;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const done = useRef(false);
  const gesture = useRef<{ update(c: never[] | unknown[]): void; abort(): void } | null>(null);
  const start = useRef(shape.text ?? '');

  // Hold a lock for the whole session. A freshly placed text already has its creation gesture open (pendingText).
  useEffect(() => {
    done.current = false;
    const { board } = env;
    const pend = env.pendingText?.id === id ? env.pendingText : null;
    const push = () => {
      const value = ref.current?.value ?? start.current;
      if (pend) pend.g.update([{ t: 'shape.create', kind: 'text', id, parent: pend.parent, props: { ...pend.props, text: value } }]);
      else gesture.current?.update([{ t: 'shape.update', ids: [id], patch: { text: value } }]);
    };
    if (!pend) gesture.current = board.gesture(board.me, 'Edit text') as never;
    try { push(); } catch { /* superseded */ }
    const timer = setInterval(() => { if (!composing.current) try { push(); } catch { /* ignore */ } }, KEEPALIVE_MS);
    return () => {
      clearInterval(timer);
      if (done.current) return;
      // Unmounted without a commit (e.g. editing cleared elsewhere): keep typed text, drop the lock gesture.
      const value = ref.current?.value ?? start.current;
      try { gesture.current?.abort(); } catch { /* already finished */ }
      gesture.current = null;
      if (!pend && value !== start.current) commitText(env, id, value);
    };
  }, [env, id]);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    const value = ref.current?.value ?? '';
    try { gesture.current?.abort(); } catch { /* already finished */ }
    gesture.current = null;
    commitText(env, id, value);
  };

  return (
    <textarea
      ref={ref}
      className="pg-text-editor"
      data-pg-ctx="text-edit"
      autoFocus
      defaultValue={shape.text}
      placeholder="Type something"
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => { if (!composing.current) finish(); else queueMicrotask(finish); }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); }}
      onPaste={(e) => {
        e.preventDefault();
        const { text } = normalizePaste(e.clipboardData.getData('text/plain'));
        const t = e.currentTarget;
        t.setRangeText(text, t.selectionStart, t.selectionEnd, 'end');
        t.dispatchEvent(new Event('input', { bubbles: true }));
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || composing.current || e.key === 'Process') return; // IME owns the keys
        e.stopPropagation(); // canvas shortcuts must not see typing
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          finish();
          e.currentTarget.blur();
        }
      }}
    />
  );
}
