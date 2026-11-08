// Operator messages (issue #11): steer a running agent from the dashboard. Calls the
// send_instruction reducer; agent '*' reaches every working or paused agent. The worker
// interrupts its current Claude Code turn and resumes the same session with the message.
import { useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '@bindings/index.ts';
import type { OperatorMsg } from './model.ts';

export function MessageBox({ agentId, label, messages = [] }: { agentId: string; label: string; messages?: OperatorMsg[] }) {
  const send = useReducer(reducers.sendInstruction);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(undefined);
    try {
      await send({ agentId, text: body });
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="msgbox">
      {messages.slice(-2).map((m) => (
        <div key={m.id} className="msg" title={m.acked ? 'The agent picked this up' : 'Waiting for the agent to pick it up'}>
          <span className="ellipsis grow">“{m.text}”</span>
          <span className={'msg-state' + (m.acked ? ' read' : '')}>{m.acked ? 'Read' : 'Sent'}</span>
        </div>
      ))}
      <form onSubmit={submit} aria-label={label}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={label} aria-label={label} maxLength={2000} />
        <button type="submit" disabled={busy || !text.trim()}>{busy ? '…' : 'Send'}</button>
      </form>
      {error && <div className="msg-error">{error}</div>}
    </div>
  );
}
