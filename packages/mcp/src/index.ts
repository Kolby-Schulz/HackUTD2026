// Contract MCP server (spec sections 10, 11). Owner: agents.
// Claude Code workers launch this via --mcp-config; it wraps @contract/client.
// It runs as its own process, so it must connect with the WORKER's identity:
// read CONTRACT_AGENT_ID and CONTRACT_TOKEN from the env the worker passes down.
import 'dotenv/config';

/** Tool names are fixed by the spec (section 11). */
export const TOOLS = [
  'declare_plan',      // -> client.publishPlan
  'claim_symbol',      // -> client.claim
  'release_claim',     // -> client.release
  'report_change',     // -> client.reportChange
  'get_context',       // -> client.getContext
  'find_existing',     // -> client.findExisting
  'get_instructions',  // -> client.pendingInstructions
] as const;

console.error('contract mcp: not implemented yet');
