# Live integration tests

Real WebSocket clients (one identity per simulated laptop) against a running SpacetimeDB.
They publish to a throwaway database, `contract-livetest`, wiping it first, so the demo's
`contract` database is never touched.

```bash
spacetime start                      # in another terminal (add --listen-addr 127.0.0.1:3001 if 3000 is taken)
SPACETIME_HOST=ws://localhost:3000 npm run test:live -w @contract/server
```

Takes about 30 s (one test waits for the real `expire_claims` schedule).
Unit tests need no server: `npm test -w @contract/server`.
