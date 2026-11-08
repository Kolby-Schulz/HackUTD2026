import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { connectionBuilder } from './data.ts';
import { App } from './App.tsx';
import { Playground } from './playground/Playground.tsx';
import './styles.css';

// #/playground is a temporary standalone page (no SpacetimeDB connection).
const isPlayground = () => /^#\/?playground/.test(location.hash);
function Root() {
  const [pg, setPg] = useState(isPlayground);
  useEffect(() => {
    const on = () => setPg(isPlayground());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  if (pg) return <Playground />;
  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <App />
    </SpacetimeDBProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
