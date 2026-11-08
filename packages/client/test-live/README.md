# Client live tests

The real `connect()` client, several identities at once, against a running SpacetimeDB.
They publish `server/` to a throwaway database, `contract-clienttest` (wiped first).

```bash
spacetime start                      # another terminal (add --listen-addr 127.0.0.1:3001 if 3000 is taken)
SPACETIME_HOST=ws://localhost:3000 npm run test:live -w @contract/client
```

Unit tests (no server): `npm test -w @contract/client`.
