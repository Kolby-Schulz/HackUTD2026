# Lessons

One line each, newest last: `YYYY-MM-DD - what went wrong or surprised us - what to do instead`.
Agents read this before planning; keep it short and prune what stopped being true.
- 2026-11-08: Vault bootstrap with 6 parallel Haiku writers (~675k subagent tokens, ~105s). One false claim found on spot-check (COORDINATOR_PROVIDER called stale). Keep spot-checking env/config claims against git grep.
