import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { connectionBuilder } from './data.ts';
import { App } from './App.tsx';
import { MachineProvider } from './machine.tsx';
import '@fontsource-variable/unbounded';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';

// #/variants is a standalone page (no SpacetimeDB connection), loaded on demand so the main bundle doesn't grow.
const Variants = lazy(() => import('./variants/Variants.tsx').then((m) => ({ default: m.Variants })));
const isVariants = () => /^#\/?variants/.test(location.hash);

function Root() {
  const [variants, setVariants] = useState(isVariants);
  useEffect(() => {
    const on = () => setVariants(isVariants());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  if (variants) return <Suspense fallback={null}><Variants /></Suspense>;
  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <MachineProvider>
        <App />
      </MachineProvider>
    </SpacetimeDBProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
