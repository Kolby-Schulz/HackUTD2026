// 16px line icons (DESIGN.md Shapes: 1.7px stroke, round caps and joins, currentColor; no emoji).
const PATHS = {
  back: 'M10 3.5L5.5 8l4.5 4.5',
  plus: 'M8 3.5v9M3.5 8h9',
  close: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
  branch: 'M5 3v10M5 9.5c0-2.5 6-2 6-5M11 4.5a1.5 1.5 0 1 0 0-.01M5 13a1.5 1.5 0 1 0 0-.01',
  star: 'M8 2.5l1.7 3.5 3.8.5-2.8 2.6.7 3.8L8 11.1l-3.4 1.8.7-3.8L2.5 6.5l3.8-.5z',
  link: 'M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1',
  focus: 'M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3M6 8h4',
  layers: 'M8 2.5l5.5 3L8 8.5l-5.5-3zM2.5 8.5L8 11.5l5.5-3M2.5 11L8 14l5.5-3',
  warn: 'M8 2.5l5.5 10h-11zM8 6.5v3M8 11.3v.01',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  chevron: 'M4.5 6.5L8 10l3.5-3.5',
  help: 'M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM6.3 6.2a1.8 1.8 0 0 1 3.5.6c0 1.2-1.8 1.5-1.8 2.6M8 11.3v.01',
  columns: 'M2.5 3.5h11v9h-11zM6.2 3.5v9M9.8 3.5v9',
  overlay: 'M2.5 3.5h7v7h-7zM6.5 5.5h7v7h-7z',
  import: 'M8 2.5v7.5M5 7l3 3 3-3M3 11.5v2h10v-2',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="vx-ic">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
