// Code mapper (spec section 9). Owner: coordinator + mapper.
// Library entry point: importing this never starts the CLI (that's src/cli.ts), so
// contract-hook and tests can use the parser directly.
//
//   import { mapFile } from '@contract/mapper';
//   const { symbols } = mapFile(absPath, { repoDir: worktreeDemoRepo, edges: false });
//   // compare symbols[i].signatureHash with the shared `symbol` row's signatureHash
//
// mapFile / symbolRanges / RepoMapper are TS/JS only (sync, ts-morph). For any language
// (Python, Go, Java, Rust, Ruby, PHP, C#, C/C++ too) use the async mapFileAsync /
// symbolRangesAsync / createRepoMapper. Path-only checks live in '@contract/mapper/lang'
// (no parser imports, cheap enough for every hook call).
export {
  RepoMapper,
  mapFile,
  symbolRanges,
  symbolsTouched,
  type SymbolRange,
  isMappable,
  isTsMappable,
  isPolyMappable,
  listMappableFiles,
  readMapPolicy,
  useMapPolicy,
  setMapPolicy,
  type MapPolicy,
  checkFileCount,
  maxFiles,
  WARN_FILES,
  signatureHash,
  normalizeSignature,
  cleanSignature,
  SKIP_DIRS,
  type FileMap,
  type MappedSymbol,
  type MappedEdge,
  type SymbolKind,
} from './map.ts';
export { MapSync, planUpsert, type ServerSymbol, type SyncOptions, type Upsert } from './sync.ts';
export {
  PolyglotMapper,
  createRepoMapper,
  mapFileAsync,
  symbolRangesAsync,
  mapPolyFile,
  polySymbolRanges,
  type CodeMapper,
} from './polyglot.ts';
export { isSourceFile, grammarFor, isPolyTestFile, LANGUAGE_NAMES, POLY_GRAMMARS, type Grammar } from './lang.ts';
