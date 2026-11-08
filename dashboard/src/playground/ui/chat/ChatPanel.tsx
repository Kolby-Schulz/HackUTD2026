// Chat column, in the spirit of the original web Claude Design: one conversation per agent,
// a thread switcher on top, the conversation in the middle, a roomy composer at the bottom.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMsg } from '../../chat/store';
import '../../styles/chat.css';
import { MentionTextarea } from './MentionTextarea';
import { Messages } from './MessageView';
import type { MessageEnv } from './MessageView';

/** One chat line (see chat/store.ts). `thread` is an agent id (one chat per agent) or 'general'; `from` 'you' marks the human. */
export type Msg = ChatMsg;

export type Thread = { id: string; name: string; color: string; status: string; live: boolean };

/** Messages addressed to the viewer: an @you mention or a routing card sent to them (COMMENT-6). */
const MENTION = /(^|\s)@(you|me)\b/i;
export function isMention(m: Msg): boolean {
  if (m.from === 'you') return false;
  if (m.routedBy?.to === 'you') return true;
  return m.body.kind === 'text' && MENTION.test(m.body.text);
}
/** How many of a thread's `unread` newest counted messages mention the viewer. Status, routing and own lines never count. */
export function mentionCount(msgs: readonly Msg[], thread: string, unread: number): number {
  const loud = msgs.filter((m) => m.thread === thread && m.from !== 'you' && ['text', 'action', 'conflict', 'error'].includes(m.body.kind));
  return loud.slice(Math.max(0, loud.length - unread)).filter(isMention).length;
}

/** Marks the thread read once it has been visible for 500 ms in a focused window; unmarks when it hides or the window blurs. */
const READ_DELAY_MS = 500;

export function ChatPanel(p: {
  threads: Thread[];
  active: string;
  onPick: (id: string) => void;
  flash: string | null;
  messages: readonly Msg[];
  unread: Record<string, number>;
  /** Tells the store which thread is on screen (null when the panel closes) so it counts as read. */
  onActive: (id: string | null) => void;
  env: MessageEnv;
  focusMsg: string | null;
  onFocused: () => void;
  attached?: { id: string; label: string; to?: Thread };
  onDetach: () => void;
  onSend: (text: string, shapeId?: string) => void;
  onShowShape: (id: string) => void;
  commentOn: boolean;
  onCommentTool: () => void;
}) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const thread = p.threads.find((t) => t.id === p.active) ?? p.threads[0];
  const msgs = useMemo(() => p.messages.filter((m) => m.thread === thread.id), [p.messages, thread.id]);

  const [focused, setFocused] = useState(() => typeof document === 'undefined' || document.hasFocus());
  useEffect(() => {
    const f = () => setFocused(document.hasFocus() && document.visibilityState !== 'hidden');
    window.addEventListener('focus', f); window.addEventListener('blur', f); document.addEventListener('visibilitychange', f);
    return () => { window.removeEventListener('focus', f); window.removeEventListener('blur', f); document.removeEventListener('visibilitychange', f); };
  }, []);
  useEffect(() => {
    if (!focused) { p.onActive(null); return; }
    const t = setTimeout(() => p.onActive(thread.id), READ_DELAY_MS);
    return () => { clearTimeout(t); p.onActive(null); };
  }, [thread.id, focused]);

  // total badge in the browser tab title: "(2) Playground"
  const total = Object.values(p.unread).reduce((a, b) => a + b, 0);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const base = document.title.replace(/^\(\d+\)\s/, '');
    document.title = total > 0 ? `(${total}) ${base}` : base;
    return () => { document.title = base; };
  }, [total]);

  // stick to the bottom as messages arrive, unless the user scrolled up to read
  useEffect(() => {
    const el = listRef.current;
    if (!el || p.focusMsg) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [msgs.length, thread.id, p.focusMsg]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [thread.id]);

  // jump to a message when its pin is clicked on the board
  useEffect(() => {
    if (!p.focusMsg) return;
    const el = document.getElementById(`msg-${p.focusMsg}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('hl');
    const t = setTimeout(() => { el.classList.remove('hl'); p.onFocused(); }, 1400);
    return () => clearTimeout(t);
  }, [p.focusMsg, thread.id]);

  const submit = () => {
    const v = draft.trim();
    if (!v) return;
    p.onSend(v, p.attached?.id);
    setDraft('');
  };

  return (
    <div className="pg-chat">
      <div className="pg-threads">
        {p.threads.map((t) => {
          const unread = p.unread[t.id] ?? 0;
          const mentions = unread > 0 ? mentionCount(p.messages, t.id, unread) : 0;
          return (
            <button key={t.id} className={'pg-thread' + (t.id === thread.id ? ' on' : '') + (p.flash === t.id ? ' flash' : '') + (t.live ? '' : ' gone')}
              style={{ ['--c' as string]: t.color }} onClick={() => p.onPick(t.id)}>
              {t.id === 'general' ? <span className="hash">#</span> : <i />}
              {t.name}
              {unread > 0 && (t.id !== thread.id || !focused) && (
                <em className={mentions > 0 ? 'mention' : undefined} style={mentions > 0 ? { background: 'var(--pg-danger)' } : undefined}
                  title={mentions > 0 ? `${unread} unread, ${mentions} for you` : `${unread} unread`}>{unread}</em>
              )}
            </button>
          );
        })}
      </div>

      <div className="pg-thead">
        <span className="av" style={{ background: thread.color }}>{thread.id === 'general' ? '#' : thread.name[0]}</span>
        <div>
          <b>{thread.name}</b>
          <small>{thread.id === 'general' ? 'Notes here get routed to an agent' : thread.status === 'idle' ? 'idle, ready for notes' : thread.status}</small>
        </div>
      </div>

      <div className="pg-msgs" ref={listRef}>
        {!msgs.length && (
          <div className="pg-hello">
            <div className="spark">✳</div>
            <p>{thread.id === 'general'
              ? 'Each agent on the board has its own chat. Point at any layer with the comment tool and your note goes straight to the agent that made it.'
              : `${thread.name} will post here as it works. Comments on its layers land in this chat automatically.`}</p>
            {!p.commentOn && <button onClick={p.onCommentTool}>Use the comment tool (C)</button>}
          </div>
        )}
        <Messages msgs={msgs} env={p.env} />
      </div>

      <div className="pg-compose">
        {p.attached && (
          <div className="pg-attach" style={{ ['--c' as string]: p.attached.to?.color ?? '#d97757' }}>
            <span>◎ {p.attached.label}</span>
            {p.attached.to && p.attached.to.id !== thread.id && <span className="to">→ {p.attached.to.name}</span>}
            <button onClick={p.onDetach} aria-label="Detach layer">✕</button>
          </div>
        )}
        <MentionTextarea value={draft} rows={3} onChange={setDraft}
          agents={p.threads.filter((t) => t.id !== 'general' && t.live).map((t) => ({ id: t.id, name: t.name, stopped: t.status === 'stopped' }))}
          placeholder={p.attached ? `Ask ${p.attached.to?.name ?? 'Claude'} about ${p.attached.label.split(' › ').pop()}…` : thread.id === 'general' ? 'Message the board, or @mention an agent…' : `Reply to ${thread.name}…`}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <div className="pg-compose-foot">
          <button className={'pg-mini-tool' + (p.commentOn ? ' on' : '')} onClick={p.onCommentTool} title="Comment tool (C)">◎ Point at a layer</button>
          <button className="send" disabled={!draft.trim()} onClick={submit} aria-label="Send">↑</button>
        </div>
      </div>
    </div>
  );
}
