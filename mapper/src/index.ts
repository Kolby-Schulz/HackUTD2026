// Code mapper (spec section 9). Owner: coordinator + mapper.
// npm run mapper -- --repo ../demo-repo [--watch]
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// npm -w runs us inside our own folder, so load the monorepo's .env explicitly.
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });
console.log('mapper: not implemented yet', process.argv.slice(2));
