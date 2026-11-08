// contract-hook (spec section 11, "Automatic change reporting"). Owner: agents,
// using the mapper's parser. Claude Code runs it after every Edit|Write via the
// PostToolUse hook in agents/worker/hook-settings.json.
//
// TODO:
// 1. Read the hook JSON from stdin: tool_input.file_path, cwd.
// 2. Re-parse that one file with the mapper's parser (export a mapFile() from mapper/).
// 3. Compare each symbol's signature_hash with the shared symbol row; DO NOT call
//    upsert_symbols from a worktree (that would overwrite the shared code map).
// 4. For each changed signature: client.reportChange(id, 'signature', {...}) using
//    CONTRACT_AGENT_ID + CONTRACT_TOKEN from env (connect with noHeartbeat).
// 5. Always exit 0; this hook must never block the agent.
process.exit(0);
