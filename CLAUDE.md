# Contract — rules for coding agents

The full build spec is in `docs/SPEC.md`. Read the sections for your part before coding.

## Ownership (stay in your folder)

| Folder | Owner | Spec sections |
| --- | --- | --- |
| `server/` | backend | 6, 7, 8 |
| `packages/client/`, `agents/worker/` | agents | 10, 11 |
| `packages/llm/` | shared (agents implements; interface agreed by all) | 4, 11, 15 |
| `mapper/`, `agents/coordinator/`, `demo-repo/` | coordinator + mapper | 9, 12, 14 |
| `dashboard/`, `scripts/` | dashboard + demo | 13, 15, 17 |

## Rules (spec section 18)

- You are building one part of Contract. Stay inside your folder; never edit another
  part's folder. Shared types come only from packages/client's generated bindings.
- Table names, column names, reducer names and arguments are fixed by the spec
  (sections 6, 7, 10). Do not rename them. If one must change, stop and ask the human.
- Use the official SpacetimeDB TypeScript docs for exact syntax. Do not invent APIs;
  if unsure, check the docs or ask.
- Reducers have no network or filesystem access. Anything calling Nemotron or reading
  files runs in a Node process (agents, coordinator, mapper).
- Every Nemotron call goes through packages/llm so tokens are always logged.
- Build the MVP first (section 16). No stretch features until the MVP checklist passes.
- Prefer simple, readable code over abstractions. This is a 24-hour hackathon.
- Keep secrets in .env; never commit API keys. The repo will be public.
- After each change, run the part's tests and the end-to-end script if it exists.

## Conventions

- TypeScript everywhere, ES modules, run with `tsx` (no build step for Node parts).
- Workspace packages are imported by name (`@contract/client`, `@contract/llm`) and
  export their `src/index.ts` directly.
- `demo-repo/` is NOT an npm workspace; it has its own package.json and tests.
