// D: a plain-English brief in three lines (what it does, what is happening, what to watch), with
// the technical facts tucked under "Details".
import { useState } from 'react';
import { defineVariant } from '../../../variants/define.ts';
import { mono, muted } from '../shared.ts';

const ROWS: [string, string, string, string][] = [
  // icon, color, label, text
  ['ƒ', '#2563eb', 'What it does', 'Works out the fee on an order total and rounds it to cents.'],
  ['●', '#b35900', 'Right now', 'Agent A is adding a late-fee rule (changed 20s ago).'],
  ['!', '#cf222e', 'Watch out', "Agent B's cartTotal relies on the old version. The coordinator will step in if they clash."],
];

const Body = () => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {ROWS.map(([icon, color, label, text]) => (
        <div key={label} style={{ display: 'flex', gap: 10 }}>
          <span style={{ width: 22, height: 22, flex: 'none', borderRadius: 11, background: `${color}1a`, color, fontWeight: 800, fontSize: 12, display: 'grid', placeItems: 'center' }}>{icon}</span>
          <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: muted }}>{label}</div>
            {text}
          </div>
        </div>
      ))}
      <button onClick={() => setOpen(!open)} style={{ alignSelf: 'flex-start', border: 'none', background: 'none', padding: 0, fontSize: 12, color: muted, cursor: 'pointer' }}>{open ? '▾' : '▸'} Details</button>
      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: '4px 8px', fontSize: 11.5, lineHeight: 1.45 }}>
          <span style={{ color: muted }}>Signature</span><span style={{ ...mono, fontSize: 11 }}>calculateFee(total, daysLate)</span>
          <span style={{ color: muted }}>Callers</span><span style={{ ...mono, fontSize: 11 }}>invoiceTotal, cartTotal, lateFee</span>
          <span style={{ color: muted }}>File</span><span style={{ ...mono, fontSize: 11 }}>src/billing/fees.ts</span>
        </div>
      )}
    </div>
  );
};

export default defineVariant({
  title: 'Brief: plain English',
  note: 'Three sentences anyone can read: what it does, what is happening, what to watch. Technical facts stay one click away. "What it does" would come from the mapper\'s behavior note.',
  extends: 'a-today',
  slots: { body: Body },
});
