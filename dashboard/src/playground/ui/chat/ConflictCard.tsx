// Stub for `conflict` messages (the full ruling card comes with the conflict work package).
import type { ChatMsg } from '../../chat/store';

export function ConflictCard({ m }: { m: ChatMsg }) {
  return (
    <div id={`msg-${m.id}`} className="pg-msg conflict">
      <b>Conflict</b>
      <p>{m.name} and another editor reached for the same layer. The human edit wins.</p>
    </div>
  );
}
