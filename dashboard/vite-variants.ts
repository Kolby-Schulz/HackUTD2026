// Dev-only endpoints for #/variants, so picks and mixes are saved in the repo (shared through git):
//   GET  /__variants/lineage   -> src/designs/lineage.json
//   PUT  /__variants/lineage   <- the whole lineage (normalised, stable order)
//   POST /__variants/scaffold  <- creates src/designs/<screen>/<id>/index.tsx extending a parent
// Not part of the production build; the page falls back to localStorage when these are missing.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { EMPTY_LINEAGE, isScaffoldRequest, normalizeLineage, scaffoldSource, serializeLineage } from './src/variants/files.ts';

const DESIGNS = fileURLToPath(new URL('./src/designs', import.meta.url));
const LINEAGE = join(DESIGNS, 'lineage.json');
const MAX_BODY = 1_000_000;

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) reject(new Error('body too large'));
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readLineage() {
  try { return normalizeLineage(JSON.parse(await readFile(LINEAGE, 'utf8'))); } catch { return EMPTY_LINEAGE; }
}

export function variantsPlugin(): Plugin {
  return {
    name: 'contract-variants',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0];
        if (!url?.startsWith('/__variants/')) return next();
        try {
          if (url === '/__variants/lineage' && req.method === 'GET') return send(res, 200, await readLineage());
          if (url === '/__variants/lineage' && req.method === 'PUT') {
            const l = normalizeLineage(await readBody(req));
            await writeFile(LINEAGE, serializeLineage(l));
            return send(res, 200, l);
          }
          if (url === '/__variants/scaffold' && req.method === 'POST') {
            const body = await readBody(req);
            if (!isScaffoldRequest(body)) return send(res, 400, { error: 'bad scaffold request' });
            const screenDir = join(DESIGNS, body.screen);
            const dir = join(screenDir, body.id);
            if (!existsSync(join(screenDir, 'screen.tsx'))) return send(res, 404, { error: `no screen "${body.screen}"` });
            if (existsSync(dir)) return send(res, 409, { error: `src/designs/${body.screen}/${body.id} already exists` });
            await mkdir(dir);
            await writeFile(join(dir, 'index.tsx'), scaffoldSource(body));
            return send(res, 200, { path: `src/designs/${body.screen}/${body.id}/index.tsx` });
          }
          return send(res, 404, { error: 'unknown endpoint' });
        } catch (e) {
          return send(res, 400, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
