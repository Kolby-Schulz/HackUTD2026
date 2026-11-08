import { StrictMode } from 'react';
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

function Root() {
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
