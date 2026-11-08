// B: light, editorial, explains the idea before the numbers.
import { defineVariant } from '../../../variants/define.ts';
import s from './calm.module.css';

const Nav = () => (
  <nav className={s.nav}>
    <span className={s.logo}>Contract</span>
    <span className={s.links}><a>How it works</a><a>Docs</a><a>Pricing</a></span>
    <button className={s.outline}>Book a demo</button>
  </nav>
);

const Hero = () => (
  <div data-tone="light">
    <h1 className={s.h1}>Let your agents share one codebase, calmly.</h1>
    <p className={s.sub}>Each agent claims the code it is changing. Others see it, plan around it, and ask before they touch it.</p>
  </div>
);

const Cta = () => <button className={s.cta}>Get started</button>;

const FEATURES = [
  ['Claims, not locks', 'Agents announce what they will change. Nobody waits on a lock.'],
  ['A live code map', 'Every function, who is editing it and what depends on it.'],
  ['A coordinator', 'When two agents collide, one model decides and both are told why.'],
  ['Every token counted', 'Each model call is logged, so you can see what coordination costs.'],
];
const Grid = () => (
  <div className={s.grid}>
    {FEATURES.map(([h, p], i) => (
      <div key={h} className={s.card}>
        <span className={s.icon} style={{ background: ['#d9e7ff', '#e3f5e1', '#fbe7d6', '#efe3fb'][i] }} />
        <h3 className={s.h3}>{h}</h3>
        <p className={s.p}>{p}</p>
      </div>
    ))}
  </div>
);

const Footer = () => (
  <footer className={s.footer}>
    <div><b className={s.logo}>Contract</b><p>Coordination for coding agents.</p></div>
    <div><b>Product</b><p>Code map<br />Coordinator<br />Replay</p></div>
    <div><b>Company</b><p>About<br />Contact</p></div>
  </footer>
);

export default defineVariant({
  title: 'Calm',
  note: 'Light editorial look, outline button, explanatory cards.',
  slots: { nav: Nav, hero: Hero, cta: Cta, grid: Grid, footer: Footer },
});
