// Board UI state (tool, text editing, comment hover/popover, space-pan) and the environment every
// gesture, overlay and action reads. Not document state: nothing here is saved or undone.
import { opId } from '../../core/ids';
import type { BoardKit } from '../../core/commands';
import type { CameraStore } from '../../core/camera';
import type { Cam, Gesture, Pt, ShapeId } from '../../core/types';

export type Tool = 'select' | 'frame' | 'rect' | 'ellipse' | 'text' | 'hand' | 'comment';
/** The comment popover: which layer, and the world point that was clicked (the pin goes there). */
export type Popover = { shapeId: ShapeId; wx: number; wy: number };

export interface UiState {
  tool: Tool;
  editing: ShapeId | null;
  hover: ShapeId | null;
  pop: Popover | null;
  space: boolean;      // Space held: drags pan
  panning: boolean;    // a pan drag is in progress
  /** Autosave handle (`core/persist.ts`), set once by the kit; the top bar shows its status. */
  persistence: import('../../core/persist').Persistence | null;
}

export interface UiStore {
  get(): UiState;
  set(patch: Partial<UiState>): void;
  subscribe(l: () => void): () => void;
  /** Escape with nothing else to cancel: shell menus close themselves through this. */
  onEscape(l: () => void): () => void;
  emitEscape(): void;
}

export function createUiStore(): UiStore {
  let s: UiState = { tool: 'select', editing: null, hover: null, pop: null, space: false, panning: false, persistence: null };
  const subs = new Set<() => void>();
  const esc = new Set<() => void>();
  return {
    get: () => s,
    set(patch) {
      let changed = false;
      for (const k of Object.keys(patch) as (keyof UiState)[]) if (s[k] !== patch[k]) { changed = true; break; }
      if (!changed) return;
      s = { ...s, ...patch };
      [...subs].forEach((l) => l());
    },
    subscribe(l) { subs.add(l); return () => { subs.delete(l); }; },
    onEscape(l) { esc.add(l); return () => { esc.delete(l); }; },
    emitEscape() { [...esc].forEach((l) => l()); },
  };
}

/** Screen-space painters run once per frame after the camera, document or presence changed. */
export interface Painter {
  add(fn: (cam: Cam) => void): () => void;
  wake(): void;
}

/** What the board hands to gestures, overlays and actions. One per mounted board. */
export interface BoardEnv {
  board: BoardKit;
  camera: CameraStore;
  ui: UiStore;
  paint: Painter;
  /** Last pointer position in view-local px; `inside` = over the board. */
  pointer: { x: number; y: number; inside: boolean };
  /** A text layer being typed into for the first time: its creation gesture stays open until commit. */
  pendingText: { id: ShapeId; g: Gesture; props: Record<string, unknown>; parent: ShapeId | null } | null;
  /** Cancel the gesture in progress (Escape mid-drag). True when there was one. */
  cancelGesture(): boolean;
}

/** World point to view-local px (the overlay layer's coordinate space). */
export const w2v = (cam: Cam, p: Pt): Pt => ({ x: p.x * cam.z + cam.x, y: p.y * cam.z + cam.y });

/** Selection is presence, but it still goes through the command API so events fire. */
export function selectIds(board: BoardKit, ids: ShapeId[]) {
  board.exec({ actor: board.me, opId: opId(board.me), commands: [{ t: 'selection.set', ids }] });
}
export const selectedIds = (board: BoardKit): readonly ShapeId[] => board.selection.get(board.me).ids;

// ---- the board the global actions act on (set by the mounted Board) ----
let active: BoardEnv | null = null;
export function setActiveBoard(env: BoardEnv | null) { active = env; }
export function activeBoard(): BoardEnv | null { return active; }
