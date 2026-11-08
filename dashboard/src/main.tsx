import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { connectionBuilder } from './data.ts';
import { App } from './App.tsx';
import { MachineProvider } from './machine.tsx';
import '@fontsource-variable/unbounded';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';
import { applyInitialTheme } from './theme.ts';

applyInitialTheme();

// #/variants is its own page on the same SpacetimeDB connection, loaded on demand so the main bundle doesn't grow.
const Variants = lazy(() => import('./variants/Variants.tsx').then((m) => ({ default: m.Variants })));
// #/playground (the design board) opens its own board connection (playground/net), so it sits outside the provider.
const Playground = lazy(() => import('./playground/Playground.tsx').then((m) => ({ default: m.Playground })));
type Page = 'variants' | 'playground' | 'app';
const pageOf = (): Page => (/^#\/?variants/.test(location.hash) ? 'variants' : /^#\/?playground/.test(location.hash) ? 'playground' : 'app');

function Root() {
  const [page, setPage] = useState(pageOf);
  useEffect(() => {
    const on = () => setPage(pageOf());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  if (page === 'playground') return <Suspense fallback={null}><Playground /></Suspense>;
  const variants = page === 'variants';
  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      {variants ? (
        <Suspense fallback={null}><Variants /></Suspense>
      ) : (
        <MachineProvider>
          <App />
        </MachineProvider>
      )}
    </SpacetimeDBProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
