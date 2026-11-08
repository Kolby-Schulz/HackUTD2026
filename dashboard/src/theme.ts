// Light / dark theme. Follows the system until the header toggle picks one, which is remembered
// in this browser. The choice is applied as <html data-theme="light|dark">; styles.css holds both
// palettes, so every panel switches at once.
import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'insync.theme';
const media = () => window.matchMedia?.('(prefers-color-scheme: dark)');

function stored(): Theme | undefined {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : undefined;
  } catch { return undefined; }
}
const system = (): Theme => (media()?.matches ? 'dark' : 'light');

/** Sets the theme before the first render, so the page never flashes the wrong one. */
export function applyInitialTheme(): void {
  document.documentElement.dataset.theme = stored() ?? system();
}

export function useTheme(): [Theme, () => void] {
  const [picked, setPicked] = useState<Theme | undefined>(stored);
  const [sys, setSys] = useState<Theme>(system);
  useEffect(() => {
    const m = media();
    if (!m) return;
    const on = () => setSys(m.matches ? 'dark' : 'light');
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  const theme = picked ?? sys;
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setPicked(next);
    try { localStorage.setItem(KEY, next); } catch { /* storage blocked: still switches for this visit */ }
  };
  return [theme, toggle];
}
