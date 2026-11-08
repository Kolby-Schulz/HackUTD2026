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
const isVariants = () => /^#\/?variants/.test(location.hash);

function Root() {
  const [variants, setVariants] = useState(isVariants);
  useEffect(() => {
    const on = () => setVariants(isVariants());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
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
