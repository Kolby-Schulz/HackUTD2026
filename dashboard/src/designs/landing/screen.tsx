// The landing page: five slots. Variants fill them; the layout only places them.
// A hero sets data-tone on its root and the stage behind hero + button takes that tone (CSS :has),
// so a button taken from another variant still sits on the hero's background.
import { defineScreen } from '../../variants/define.ts';
import s from './layout.module.css';

export default defineScreen({
  title: 'Landing page',
  description: 'The public page for Contract.',
  width: 1280,
  slots: { nav: 'Top nav', hero: 'Hero', cta: 'Primary button', grid: 'Feature grid', footer: 'Footer' },
  Layout: ({ slots }) => (
    <div className={s.page}>
      {slots.nav}
      <section className={s.stage}>
        {slots.hero}
        <div className={s.cta}>{slots.cta}</div>
      </section>
      <section className={s.body}>{slots.grid}</section>
      {slots.footer}
    </div>
  ),
});
