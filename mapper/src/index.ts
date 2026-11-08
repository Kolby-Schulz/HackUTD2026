// Code mapper (spec section 9). Owner: coordinator + mapper.
// Library entry point: importing this never starts the CLI (that's src/cli.ts), so
// contract-hook and tests can use the parser directly.
//
//   import { mapFile } from '@contract/mapper';
//   const { symbols } = mapFile(absPath, { repoDir: worktreeDemoRepo, edges: false });
//   // compare symbols[i].signatureHash with the shared `symbol` row's signatureHash
export {
  RepoMapper,
  mapFile,
  symbolRanges,
  symbolsTouched,
  type SymbolRange,
  isMappable,
  listMappableFiles,
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
