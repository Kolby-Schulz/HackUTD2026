// A: what the Overview tab shows today (baseline): signature, holder, callers, callees, file.
import { defineVariant } from '../../../variants/define.ts';
import { mono, muted } from '../shared.ts';

const Head = () => (
  <div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#f6f8fa', borderBottom: '1px solid #e5e7eb' }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: '#b35900' }} />
      <span style={{ ...mono, fontWeight: 700, flex: 1 }}>calculateFee</span>
      <span style={{ fontSize: 11.5, color: muted }}>Changed · v2</span>
      <span style={{ color: muted, fontSize: 14 }}>×</span>
    </div>
    <div style={{ display: 'flex', gap: 14, padding: '0 10px', borderBottom: '1px solid #eef1f4', fontSize: 12 }}>
      <span style={{ padding: '7px 0', fontWeight: 700, boxShadow: 'inset 0 -2px 0 #2563eb' }}>Overview</span>
      <span style={{ padding: '7px 0', color: muted }}>History 4</span>
    </div>
  </div>
);

const Body = () => (
  <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
    <div style={{ ...mono, fontSize: 12, background: '#f6f8fa', borderRadius: 4, padding: '6px 8px' }}>calculateFee(total: number, daysLate: number): number</div>
    <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: '4px 8px', fontSize: 12, lineHeight: 1.45 }}>
      <span style={{ color: muted }}>Held by</span><span>Agent A</span>
      <span style={{ color: muted }}>Called by</span><span style={{ ...mono, fontSize: 11.5 }}>invoiceTotal, cartTotal, lateFee</span>
      <span style={{ color: muted }}>Calls</span><span style={{ ...mono, fontSize: 11.5 }}>roundCents</span>
      <span style={{ color: muted }}>File</span><span style={{ ...mono, fontSize: 11.5 }}>src/billing/fees.ts</span>
    </div>
  </div>
);

export default defineVariant({
  title: 'Today (baseline)',
  note: 'Reference facts: signature, who holds it, what calls it, what it calls, file. Static; says nothing about what is happening.',
  slots: { head: Head, body: Body },
});
