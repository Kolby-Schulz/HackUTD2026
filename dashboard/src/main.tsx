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

// #/playground (the design board) opens its own board connection (playground/net), so it sits outside the provider.
// It loads on demand so the main bundle doesn't grow.
const Playground = lazy(() => import('./playground/Playground.tsx').then((m) => ({ default: m.Playground })));
const isPlayground = () => /^#\/?playground/.test(location.hash);

function Root() {
  const [playground, setPlayground] = useState(isPlayground);
  useEffect(() => {
    const on = () => setPlayground(isPlayground());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  if (playground) return <Suspense fallback={null}><Playground /></Suspense>;
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
