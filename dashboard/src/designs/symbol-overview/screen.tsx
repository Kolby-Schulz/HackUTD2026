// The function details widget on the code map (click a function): its header and the Overview tab.
// Variants try different answers to "what does someone watching agents want to know about this
// function?" All of them use the same example: Agent A is changing calculateFee while Agent B's
// cartTotal depends on it.
import { defineScreen } from '../../variants/define.ts';

const C = { border: '#d0d7de', text2: '#59636e', accent: '#2563eb' };

export default defineScreen({
  title: 'Function details: Overview tab',
  description: 'The widget that opens beside a function on the code map.',
  width: 820,
  slots: { head: 'Header', body: 'Overview tab' },
  Layout: ({ slots }) => (
    <div style={{ position: 'relative', minHeight: 520, padding: 32, display: 'flex', gap: 18, alignItems: 'flex-start', fontFamily: "-apple-system, 'Segoe UI', sans-serif", color: '#1f2328',
      background: 'radial-gradient(circle at 1px 1px, rgba(31,35,40,0.09) 1px, transparent 0) 0 0 / 20px 20px' }}>
      {/* the function box on the map that was clicked */}
      <div style={{ width: 172, height: 48, flex: 'none', marginTop: 24, borderRadius: 6, background: '#fff', border: '2px solid #b35900', padding: '0 10px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, outline: `2px solid ${C.accent}`, outlineOffset: 3, position: 'relative' }}>
        <span style={{ position: 'absolute', left: 9, top: -10, fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', color: '#fff', background: '#b35900', borderRadius: 4, padding: '1px 6px' }}>CHANGED</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 700 }}>
          <span style={{ fontSize: 8.5, fontWeight: 800, background: '#3178c6', color: '#fff', borderRadius: 3, padding: '1px 3px' }}>TS</span>
          <span style={{ flex: 1 }}>calculateFee</span>
          <span style={{ width: 16, height: 16, borderRadius: 4, background: '#58a6ff', color: '#fff', fontSize: 9, display: 'grid', placeItems: 'center' }}>A</span>
        </div>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: C.text2 }}>src/billing/fees.ts</div>
      </div>
      {/* the widget */}
      <div style={{ width: 340, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, boxShadow: '0 8px 24px rgba(31,35,40,0.16)', overflow: 'hidden' }}>
        {slots.head}
        {slots.body}
      </div>
    </div>
  ),
});
