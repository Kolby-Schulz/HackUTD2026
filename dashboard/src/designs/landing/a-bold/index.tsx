// A: dark, high-contrast, numbers first.
import { defineVariant } from '../../../variants/define.ts';
import s from './bold.module.css';

const Nav = () => (
  <nav className={s.nav}>
    <span className={s.logo}>◆ Contract</span>
    <span className={s.links}><a>Product</a><a>Docs</a><a>Pricing</a></span>
    <button className={s.ghost}>Sign in</button>
  </nav>
);

const Hero = () => (
  <div data-tone="dark">
    <div className={s.eyebrow}>Multi-agent coding</div>
    <h1 className={s.h1}>Many agents.<br />One codebase.<br />Zero collisions.</h1>
    <p className={s.sub}>Contract gives every coding agent a live map of who is changing what, so they stop overwriting each other.</p>
  </div>
);

const Cta = () => <button className={s.cta}>Start a run →</button>;

const STATS = [
  ['12', 'agents in parallel'],
  ['0', 'merge conflicts'],
  ['3.2×', 'faster to green'],
  ['100%', 'tokens logged'],
];
const Grid = () => (
  <div className={s.grid}>
    {STATS.map(([n, l]) => (
      <div key={l} className={s.tile}><div className={s.num}>{n}</div><div className={s.label}>{l}</div></div>
    ))}
  </div>
);

const Footer = () => (
  <footer className={s.footer}><span>◆ Contract</span><span>Built at HackUTD 2026</span></footer>
);

export default defineVariant({
  title: 'Bold',
  note: 'Dark hero, gradient pill button, stat tiles.',
  slots: { nav: Nav, hero: Hero, cta: Cta, grid: Grid, footer: Footer },
});
