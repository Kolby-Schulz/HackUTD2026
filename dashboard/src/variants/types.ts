// Types for the variant picker (#/variants). A screen declares named slots; a variant is a folder of
// React components that fill some of them; a combination ("mix") is a saved record of which node
// supplies each slot. Code variants live in src/designs/ (git); mixes, picks, votes and generation jobs live in
// SpacetimeDB (see live.ts and store.ts).
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
