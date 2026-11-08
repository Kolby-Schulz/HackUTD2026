// Chat column, in the spirit of the original web Claude Design: one conversation per agent,
// a thread switcher on top, the conversation in the middle, a roomy composer at the bottom.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Msg } from './engine.ts';

export type Thread = { id: string; name: string; color: string; status: string; live: boolean };

export function ChatPanel(p: {
  threads: Thread[];
  active: string;
  onPick: (id: string) => void;
  flash: string | null;
  messages: Msg[];
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
  const [seen, setSeen] = useState<Record<string, number>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const thread = p.threads.find((t) => t.id === p.active) ?? p.threads[0];
  const msgs = useMemo(() => p.messages.filter((m) => m.thread === thread.id), [p.messages, thread.id]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of p.messages) if (m.from !== 'you') c[m.thread] = (c[m.thread] ?? 0) + 1;
    return c;
  }, [p.messages]);

  // the open thread is always "read"
  useEffect(() => { setSeen((s) => (s[thread.id] === counts[thread.id] ? s : { ...s, [thread.id]: counts[thread.id] ?? 0 })); }, [thread.id, counts]);

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
          const unread = (counts[t.id] ?? 0) - (seen[t.id] ?? 0);
          return (
            <button key={t.id} className={'pg-thread' + (t.id === thread.id ? ' on' : '') + (p.flash === t.id ? ' flash' : '') + (t.live ? '' : ' gone')}
              style={{ ['--c' as string]: t.color }} onClick={() => p.onPick(t.id)}>
              {t.id === 'general' ? <span className="hash">#</span> : <i />}
              {t.name}
              {unread > 0 && t.id !== thread.id && <em>{unread}</em>}
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
        {msgs.map((m) => (
          m.from === 'you' ? (
            <div key={m.id} id={`msg-${m.id}`} className="pg-msg you">
              {m.ctx && <Ctx m={m} onShow={p.onShowShape} />}
              <div className="bubble">{m.text}</div>
            </div>
          ) : (
            <div key={m.id} id={`msg-${m.id}`} className="pg-msg agent">
              <span className="av" style={{ background: m.color }}>{m.from === 'claude' ? '✳' : m.name[0]}</span>
              <div className="body">
                <b style={{ color: m.color }}>{m.name}</b>
                {m.ctx && <Ctx m={m} onShow={p.onShowShape} />}
                <p>{m.text}</p>
              </div>
            </div>
          )
        ))}
      </div>

      <div className="pg-compose">
        {p.attached && (
          <div className="pg-attach" style={{ ['--c' as string]: p.attached.to?.color ?? '#d97757' }}>
            <span>◎ {p.attached.label}</span>
            {p.attached.to && p.attached.to.id !== thread.id && <span className="to">→ {p.attached.to.name}</span>}
            <button onClick={p.onDetach} aria-label="Detach layer">✕</button>
          </div>
        )}
        <textarea value={draft} rows={3}
          placeholder={p.attached ? `Ask ${p.attached.to?.name ?? 'Claude'} about ${p.attached.label.split(' › ').pop()}…` : thread.id === 'general' ? 'Message the board…' : `Reply to ${thread.name}…`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <div className="pg-compose-foot">
          <button className={'pg-mini-tool' + (p.commentOn ? ' on' : '')} onClick={p.onCommentTool} title="Comment tool (C)">◎ Point at a layer</button>
          <button className="send" disabled={!draft.trim()} onClick={submit} aria-label="Send">↑</button>
        </div>
      </div>
    </div>
  );
}

function Ctx({ m, onShow }: { m: Msg; onShow: (id: string) => void }) {
  return (
    <button className="pg-ctx" onClick={() => m.shapeId && onShow(m.shapeId)} disabled={!m.shapeId} title="Show on board">
      ◎ {m.ctx}
    </button>
  );
}
