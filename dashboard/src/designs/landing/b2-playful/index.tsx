// A child of Calm: same nav, hero and footer, but a sticker button and tilted cards.
import { defineVariant } from '../../../variants/define.ts';
import s from './playful.module.css';

const Cta = () => <button className={s.cta}>Let’s go ✦</button>;

const CARDS = [
  ['Claim it', 'Say what you will change.', '#ffe48a'],
  ['See it', 'A map of who touches what.', '#b8f0d4'],
  ['Settle it', 'A coordinator breaks ties.', '#ffc8dd'],
];
const Grid = () => (
  <div className={s.grid}>
    {CARDS.map(([h, p, bg], i) => (
      <div key={h} className={s.card} style={{ background: bg, transform: `rotate(${[-2, 1.5, -1][i]}deg)` }}>
        <div className={s.n}>{i + 1}</div>
        <h3 className={s.h3}>{h}</h3>
        <p className={s.p}>{p}</p>
      </div>
    ))}
  </div>
);

export default defineVariant({
  title: 'Playful',
  note: 'Tries a friendlier button and fewer, louder cards on top of Calm.',
  extends: 'b-calm',
  slots: { cta: Cta, grid: Grid },
});
