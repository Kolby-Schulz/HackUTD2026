// Playground (#/playground): a Figma / Claude-Design style board where you and several scripted
// agent cursors design at once. Each agent has a chat; the comment tool routes a note on a layer to
// the agent that made it. Not wired to SpacetimeDB.
//
// COMPOSITION ROOT, FROZEN: wiring only. It creates the board, boots the agents, and mounts the
// shell and every slot (each in its own ErrorBoundary). A feature fills its own slot file and never
// edits this one. Business logic lives next to the component that uses it (ui/chat/useChat.ts,
// ui/comments/route.ts, ui/useBoot.ts); every document change goes through board.exec / board.gesture.
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AgentRuntime } from '../agents/runtime';
import { camera } from '../core/camera';
import '../actions/index';
import '../styles/tokens.css';
import '../styles/base.css';
import { AgentsPanel } from './AgentsPanel';
import { Board } from './board/Board';
import { ChatView } from './chat/ChatView';
import { useChat } from './chat/useChat';
import { CommandPalette } from './CommandPalette';
import { CommentList } from './comments/CommentList';
import { CommentPopover } from './comments/CommentPopover';
import { PinPopover } from './comments/PinPopover';
import { Pins } from './comments/Pins';
import { Cursors } from './Cursors';
import { DebugHud } from './DebugHud';
import { DemoBar } from './DemoBar';
import { HelpOverlay } from './HelpOverlay';
import { Inspector } from './inspector/Inspector';
import { createKit } from './kit';
import { LayersPanel } from './layers/LayersPanel';
import { useActorMeta } from './meta';
import { Minimap } from './Minimap';
import { PresenceList } from './PresenceList';
import { Present } from './Present';
import { ContextMenu } from './shell/ContextMenu';
import { Dialog } from './shell/Dialog';
import { ErrorBoundary } from './shell/ErrorBoundary';
import { FollowBanner } from './shell/FollowBanner';
import { LeftPanel, RightPanel } from './shell/Panels';
import type { LeftTab } from './shell/Panels';
import { Toasts } from './shell/Toasts';
import { Toolbar } from './shell/Toolbar';
import { TopBar } from './shell/TopBar';
import { Tooltip } from './shell/Tooltip';
import type { SlotProps } from './slotProps';
import { useBoot } from './useBoot';

export { humanId } from './kit';
export type { Pin } from './comments/route';

/** A floating slot: a crash hides that slot only. */
const Safe = ({ n, children }: { n: string; children: ReactNode }) => <ErrorBoundary name={n} silent>{children}</ErrorBoundary>;

export function Playground() {
  const [{ board, ui, sink }] = useState(createKit);
  const cursors = useActorMeta(board);
  const [leftTab, setLeftTab] = useState<LeftTab>('chat');
  const rtRef = useRef<AgentRuntime | null>(null);
  const chat = useChat(board, sink, rtRef, cursors, useCallback(() => setLeftTab('chat'), []));
  const rt = useBoot(board, sink, rtRef, chat.reset);
  const p: SlotProps = { board, ui, rt, cursors };

  return (
    <div className="pg">
      <ErrorBoundary name="Top bar">
        <TopBar {...p} showPins={chat.showPins} onShowPins={chat.setShowPins} onClearResolved={chat.clearResolved} />
      </ErrorBoundary>

      <div className="pg-body">
        <LeftPanel board={board} tab={leftTab} onTab={setLeftTab}>
          {leftTab === 'chat' ? <ChatView {...p} chat={chat} /> : <LayersPanel {...p} />}
        </LeftPanel>

        <ErrorBoundary name="Board">
          <Board board={board} camera={camera} ui={ui} describeTarget={chat.describeTarget}>
            {chat.showPins && <Safe n="Pins"><Pins pins={chat.pins} threads={chat.threads} messages={chat.messages} onOpen={chat.openThread} /></Safe>}
            <Safe n="Comment popover"><CommentPopover {...p} threadOf={chat.threadOf} onSend={chat.send} /></Safe>
            <Safe n="Pin popover"><PinPopover {...p} /></Safe>
            <Safe n="Cursors"><Cursors cursors={cursors} /></Safe>
            <Safe n="Toolbar"><Toolbar ui={ui} /></Safe>
            <Safe n="Toasts"><Toasts /></Safe>
            <Safe n="Minimap"><Minimap {...p} /></Safe>
            <Safe n="Follow banner"><FollowBanner {...p} /></Safe>
            <Safe n="Demo bar"><DemoBar {...p} /></Safe>
          </Board>
        </ErrorBoundary>

        <RightPanel>
          <ErrorBoundary name="Inspector"><Inspector {...p} /></ErrorBoundary>
          <ErrorBoundary name="Agents"><AgentsPanel {...p}><PresenceList {...p} /></AgentsPanel></ErrorBoundary>
          <ErrorBoundary name="Comments"><CommentList {...p} /></ErrorBoundary>
        </RightPanel>
      </div>

      <Safe n="Context menu"><ContextMenu {...p} /></Safe>
      <Safe n="Dialog"><Dialog {...p} /></Safe>
      <Safe n="Tooltip"><Tooltip {...p} /></Safe>
      <Safe n="Command palette"><CommandPalette {...p} /></Safe>
      <Safe n="Help overlay"><HelpOverlay {...p} /></Safe>
      <Safe n="Present"><Present {...p} /></Safe>
      <Safe n="Debug HUD"><DebugHud {...p} /></Safe>
    </div>
  );
}
