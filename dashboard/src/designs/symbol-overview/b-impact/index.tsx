// B: "What could break?" Leads with the blast radius: which callers depend on this change and
// whether another agent is working on them right now.
import { defineVariant } from '../../../variants/define.ts';
import { mono, muted } from '../shared.ts';

const CALLERS: [string, string, string, string][] = [
  // name, file, status, color
  ['cartTotal', 'src/checkout/cart.ts', 'Agent B is editing it', '#cf222e'],
  ['invoiceTotal', 'src/billing/invoice.ts', "In Agent A's plan", '#1a7f37'],
  ['lateFee', 'src/billing/fees.ts', 'Nobody on it', muted],
];

const label = { fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: muted, marginBottom: 4 } as const;

const Body = () => (
  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 6, background: '#fff1e5', border: '1px solid #f5c89a' }}>
      <span style={{ fontSize: 22, fontWeight: 800, color: '#b35900' }}>3</span>
      <span style={{ fontSize: 12.5, lineHeight: 1.4 }}><b>functions call this.</b> One of them is being changed by another agent right now.</span>
    </div>
    <div>
      <div style={label}>WHAT CHANGED</div>
      <div style={{ ...mono, fontSize: 11.5, lineHeight: 1.6, background: '#f6f8fa', borderRadius: 4, padding: '4px 8px' }}>
        <div style={{ color: '#cf222e' }}>- calculateFee(total: number): number</div>
        <div style={{ color: '#1a7f37' }}>+ calculateFee(total: number, daysLate: number): number</div>
      </div>
    </div>
    <div>
      <div style={label}>CALLERS AT RISK</div>
      {CALLERS.map(([n, f, st, c]) => (
        <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #eef1f4', fontSize: 12 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: c, flex: 'none' }} />
          <span style={{ flex: 1, minWidth: 0 }}><span style={{ ...mono, fontWeight: 700 }}>{n}</span><br /><span style={{ ...mono, fontSize: 10.5, color: muted }}>{f}</span></span>
          <span style={{ color: c, fontWeight: 600, fontSize: 11.5 }}>{st}</span>
        </div>
      ))}
    </div>
    <button style={{ alignSelf: 'flex-start', border: '1px solid #d0d7de', background: '#fff', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: '#2563eb', fontWeight: 600 }}>Highlight callers on the map</button>
  </div>
);

export default defineVariant({
  title: 'Impact: what could break',
  note: 'Answers "if this changes, what breaks?": the signature change as a diff, and each caller with who is on it now.',
  extends: 'a-today',
  slots: { body: Body },
});
