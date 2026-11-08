// C: "What's happening right now?" Who is working on it, on which task, how far along, the latest
// edit as a diff, who is waiting on it, and quick actions.
import { defineVariant } from '../../../variants/define.ts';
import { mono, muted } from '../shared.ts';

const Body = () => (
  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <span style={{ width: 28, height: 28, borderRadius: 6, background: '#58a6ff', color: '#fff', fontWeight: 800, display: 'grid', placeItems: 'center' }}>A</span>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.35 }}>
        <b>Agent A is changing this</b>
        <div style={{ color: muted, fontSize: 12 }}>Task: Add late fees to invoices</div>
      </div>
      <span style={{ fontSize: 11, color: '#1a7f37', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: 4, background: '#1a7f37' }} />working</span>
    </div>
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: muted, marginBottom: 4 }}><span>Plan step 3 of 5</span><span>started 2m 10s ago</span></div>
      <div style={{ height: 6, borderRadius: 3, background: '#eef1f4', overflow: 'hidden' }}><div style={{ width: '60%', height: '100%', background: '#58a6ff' }} /></div>
    </div>
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: muted, marginBottom: 4 }}><span>LATEST EDIT</span><span style={{ fontWeight: 500, letterSpacing: 0 }}>20s ago</span></div>
      <div style={{ ...mono, fontSize: 11, lineHeight: 1.6, border: '1px solid #e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ padding: '0 8px', color: muted }}>  const base = total * RATE;</div>
        <div style={{ padding: '0 8px', background: '#dafbe1' }}>+ const late = daysLate &gt; 30 ? total * 0.02 : 0;</div>
        <div style={{ padding: '0 8px', background: '#ffebe9' }}>- return roundCents(base);</div>
        <div style={{ padding: '0 8px', background: '#dafbe1' }}>+ return roundCents(base + late);</div>
      </div>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '6px 8px', borderRadius: 6, background: '#f6f8fa' }}>
      <span style={{ width: 18, height: 18, borderRadius: 4, background: '#f778ba', color: '#fff', fontSize: 10, fontWeight: 800, display: 'grid', placeItems: 'center' }}>B</span>
      <span style={{ flex: 1 }}>Agent B is waiting on it (<span style={mono}>cartTotal</span>)</span>
    </div>
    <div style={{ display: 'flex', gap: 6 }}>
      <button style={{ border: 'none', background: '#2563eb', color: '#fff', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 600 }}>Message Agent A</button>
      <button style={{ border: '1px solid #d0d7de', background: '#fff', borderRadius: 6, padding: '5px 10px', fontSize: 12 }}>Open in Changes</button>
    </div>
  </div>
);

export default defineVariant({
  title: 'Live: who is on it now',
  note: 'Answers "what is happening to this right now?": the agent, its task and progress, the latest edit, who is waiting, and actions to message or open the diff.',
  extends: 'a-today',
  slots: { body: Body },
});
