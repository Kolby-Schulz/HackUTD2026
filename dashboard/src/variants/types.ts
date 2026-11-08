// Types for the variant picker (#/variants). A screen declares named slots; a variant is a folder of
// React components that fill some of them; a combination ("mix") is a saved record of which node
// supplies each slot. Code variants live in src/designs/, mixes and decisions in src/designs/lineage.json.
import type { ComponentType, ReactNode } from 'react';

export type SlotId = string;
export type NodeId = string; // a code variant's folder name, or a mix id

/** What a screen file (src/designs/<screen>/screen.tsx) exports. */
export interface ScreenSpec {
  title: string;
  description?: string;
  /** Design width in px for the desktop view. Defaults to 1280. */
  width?: number;
  /** Slot id -> human label, in display order. */
  slots: Record<SlotId, string>;
  /** Places the slot elements on the page. */
  Layout: ComponentType<{ slots: Record<SlotId, ReactNode> }>;
}

/** What a variant file (src/designs/<screen>/<variant>/index.tsx) exports. */
export interface VariantSpec {
  title: string;
  note?: string;
  author?: string;
  /** Start from another node (a code variant or a mix) and override only some slots. */
  extends?: NodeId;
  slots: Partial<Record<SlotId, ComponentType>>;
}

/** A saved combination. `picks` maps every slot to the node it was taken from. */
export interface Combo {
  id: NodeId;
  screen: string;
  title: string;
  note?: string;
  parents: NodeId[];
  picks: Record<SlotId, NodeId>;
  createdAt: string;
}

/**
 * A frame brought in from the #/playground board. `live` re-renders whenever the playground saves;
 * `copy` is frozen: its shapes are stored here, so it survives board edits and is shared through git.
 */
export interface BoardRef {
  id: NodeId;
  screen: string;
  title: string;
  boardId: string;
  frameId: string;
  mode: 'live' | 'copy';
  /** Copy mode only: the frame and its descendants, as saved by the playground (plain JSON records). */
  shapes?: Record<string, unknown>[];
  importedAt: string;
}

export interface Lineage {
  version: 1;
  combos: Combo[];
  boards: BoardRef[];
  /** Screen id -> the node chosen as the final design. */
  final: Record<string, NodeId>;
}
