# Mapper live tests

The mapper against a real SpacetimeDB: full sync, no-op restarts, version bumps, the
`behavior_note` / reported-signature preservation, Rule 1 firing through mapper-made
edges, and the CLI in one-shot and `--watch` mode.

```bash
spacetime start                                  # or any running server
SPACETIME_HOST=ws://localhost:3000 npm run test:live -w @contract/mapper
```

The setup publishes `server/` to a throwaway database (`contract-mappertest`, override
with `CONTRACT_MAPPER_LIVE_DB`) and wipes it first; it never touches `contract`.
