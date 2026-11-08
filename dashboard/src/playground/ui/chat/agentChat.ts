// Agent chat lines that are not plain text (COMMENT-12, COMMENT-16): the thinking placeholder and the action card.
// `startAgents(board, { ...agentChatHooks(sink.chat) })` wires both. Pure TS over the chat store.
import type { Actor } from '../../core/types';
import type { ChatStore } from '../../chat/store';
import type { ActionInfo } from '../../agents/runtime';

export const THINKING = 'Thinking…';
const ended = { kind: 'status', text: '', final: true } as const;

export function agentChatHooks(store: ChatStore) {
  const open = new Map<string, string>();    // agent id -> id of its placeholder message
  const who = (a: Actor) => ({ thread: a.id, from: a.id, name: a.name, color: a.color });
  const close = (id: string) => {
    const m = open.get(id);
    if (m) { open.delete(id); store.update(m, { body: ended, text: '' }); }
  };
  // a placeholder left over from a reload (the run that owned it is gone) must not spin forever
  for (const m of store.messages()) if (m.body.kind === 'status' && m.body.text === THINKING && !m.body.final) store.update(m.id, { body: ended, text: '' });

  return {
    onThinking(a: Actor, on: boolean, task?: { shapeId?: string }) {
      close(a.id);
      if (on) open.set(a.id, store.post({ ...who(a), body: { kind: 'status', text: THINKING }, ...(task?.shapeId ? { shapeId: task.shapeId } : {}) }).id);
    },
    onAction(a: Actor, c: ActionInfo) {
      close(a.id);
      store.post({ ...who(a), body: { kind: 'action', summary: c.summary, tx: c.tx, layers: c.layers } });
    },
  };
}
