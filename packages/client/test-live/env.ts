// Where the live tests connect. Defaults to SPACETIME_HOST (ws://localhost:3000 in .env.example).
export const LIVE_WS = process.env.SPACETIME_HOST ?? 'ws://localhost:3000';
// HTTP form of the same host (ws -> http, wss -> https), used for REST calls like publish.
export const LIVE_HTTP = LIVE_WS.replace(/^ws/, 'http');
// A throwaway database so tests never touch the demo's `contract` data.
export const LIVE_DB = process.env.CONTRACT_CLIENT_LIVE_DB ?? 'contract-clienttest';
