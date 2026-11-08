// The chat column wired to the page: reads the selection and tool itself, sends through useChat.
import { camera } from '../../core/camera';
import { useMemo } from 'react';
import { useShape } from '../../core/react';
import { absRect } from '../../core/tree';
import { selectIds } from '../board/state';
import { useSelection, useUi } from '../hooks';
import { ctxLabel, routeFor } from '../comments/route';
import { pickTool } from '../shell/Toolbar';
import type { SlotProps } from '../slotProps';
import { ChatPanel } from './ChatPanel';
import type { MessageEnv } from './MessageView';
import type { Chat } from './useChat';

/** Select a layer and bring it to the middle of the board (the "show on board" link in chat). */
function focusShape(board: SlotProps['board'], id: string) {
  const st = board.doc.getState();
  const s = st.shapes.get(id);
  const r = s && !s.deleted ? absRect(st, id) : null;
  if (!r) return;
  selectIds(board, [id]);
  const z = Math.max(camera.getCam().z, 0.8);
  const v = camera.getViewSize();
  camera.setCam({ z, x: v.w / 2 - (r.x + r.w / 2) * z, y: v.h / 2 - (r.y + r.h / 2) * z });
}

export function ChatView({ board, ui, rt, chat }: SlotProps & { chat: Chat }) {
  const tool = useUi(ui, 'tool');
  const editing = useUi(ui, 'editing');
  const ids = useSelection(board);
  const sel = useShape(board.doc, ids.length ? ids[ids.length - 1] : '');
  const attached = sel && !sel.deleted && sel.id !== editing
    ? { id: sel.id, label: ctxLabel(board, sel.id), to: chat.threadOf(routeFor(board, rt, sel.id).thread) }
    : undefined;
  const env: MessageEnv = useMemo(() => ({
    onShowShape: (id) => focusShape(board, id),
    nameOf: (id) => chat.threadOf(id)?.name ?? board.actors.get(id)?.name ?? id,
    layerName: (id) => {
      const s = board.doc.getState().shapes.get(id);
      return s && !s.deleted ? s.name : undefined;
    },
    onUndo: (m) => {
      if (m.body.kind !== 'action') return;
      if (board.revert(board.me, m.body.tx).ok) chat.store.update(m.id, { body: { ...m.body, undone: true } });
    },
  }), [board, chat]);
  return (
    <ChatPanel threads={chat.threads} active={chat.thread} onPick={chat.setThread} flash={chat.flash} messages={chat.messages} unread={chat.unread} onActive={chat.store.setActive} env={env}
      focusMsg={chat.focusMsg} onFocused={chat.clearFocus}
      attached={attached}
      onDetach={() => selectIds(board, [])}
      onSend={(text, shapeId) => chat.send(text, { thread: chat.thread, shapeId })}
      onShowShape={(id) => focusShape(board, id)}
      commentOn={tool === 'comment'}
      onCommentTool={() => pickTool(ui, 'comment')} />
  );
}
