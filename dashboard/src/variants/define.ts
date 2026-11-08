// Typed identity helpers for design files. The folder name is the id, so specs carry no id field.
import type { ScreenSpec, VariantSpec } from './types.ts';

export const defineScreen = (spec: ScreenSpec): ScreenSpec => spec;
export const defineVariant = (spec: VariantSpec): VariantSpec => spec;
