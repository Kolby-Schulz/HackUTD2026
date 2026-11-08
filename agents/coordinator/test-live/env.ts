// Where the coordinator live tests connect. A separate database from the server's live tests
// and from the demo's `contract`, so nothing real is touched.
export const LIVE_WS = process.env.SPACETIME_LIVE_HOST ?? 'ws://localhost:3000';
export const LIVE_HTTP = LIVE_WS.replace(/^ws/, 'http');
export const LIVE_DB = process.env.CONTRACT_COORD_LIVE_DB ?? 'contract-livetest-coord';
