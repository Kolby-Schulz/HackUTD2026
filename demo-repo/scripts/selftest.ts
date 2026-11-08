// Proves the planted conflicts are real, without any LLM (spec section 14).
// Applies hand-written versions of both agents' work to a scratch copy and checks:
//   baseline                 -> integration red,  check-dupes green
//   A + B without Contract   -> integration red (one cent), check-dupes red (two formatters)
//   A + B with Contract      -> integration green, check-dupes green
// npx tsx scripts/selftest.ts
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = join(ROOT, '.selftest'); // inside demo-repo so vitest resolves from node_modules above

// Agent A: half-up fees, a date formatter, the due date on the invoice.
const A: Record<string, string> = {
  'src/billing/fees.ts': `export const FEE_BPS = 250;
export function calculateFee(amountCents: number): number {
  return Math.round((amountCents * FEE_BPS) / 10000);
}
`,
  'src/format.ts': `export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
`,
  'src/billing/invoice.ts': `import type { LineItem, Order } from '../models.ts';
import { calculateFee } from './fees.ts';
import { formatDate } from '../format.ts';
export function subtotal(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
}
export function buildInvoice(order: Order) {
  const subtotalCents = subtotal(order.items);
  const feeCents = calculateFee(subtotalCents);
  return { orderId: order.id, lines: [], subtotalCents, feeCents, totalCents: subtotalCents + feeCents, dueDate: formatDate(order.dueDate) };
}
`,
};

// Agent B, unaware of A: rounds the fee itself (down, like the code it saw) and writes its own formatter.
const B_ALONE: Record<string, string> = {
  'src/checkout/receipt.ts': `import type { Order } from '../models.ts';
import { FEE_BPS } from '../billing/fees.ts';
import { subtotal } from '../billing/invoice.ts';
function toDisplayDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}
export function buildReceipt(order: Order): string {
  const sub = subtotal(order.items);
  const fee = Math.floor((sub * FEE_BPS) / 10000);
  return 'Total: $' + ((sub + fee) / 100).toFixed(2) + ' on ' + toDisplayDate(order.createdAt);
}
`,
};

// Agent B, told by the coordinator: use calculateFee, reuse formatDate.
const B_CONTRACT: Record<string, string> = {
  'src/checkout/receipt.ts': `import type { Order } from '../models.ts';
import { computeTotal } from './checkout.ts';
import { formatDate } from '../format.ts';
export function buildReceipt(order: Order): string {
  return 'Total: $' + (computeTotal(order) / 100).toFixed(2) + ' on ' + formatDate(order.createdAt);
}
`,
};

// Agent B, told to reuse formatDate, keeps its own name as a thin wrapper: still one formatter.
const B_WRAPPER: Record<string, string> = {
  'src/checkout/receipt.ts': `import type { Order } from '../models.ts';
import { computeTotal } from './checkout.ts';
import { formatDate } from '../format.ts';
const formatOrderDate = (date: Date): string => formatDate(date);
export function buildReceipt(order: Order): string {
  return 'Total: $' + (computeTotal(order) / 100).toFixed(2) + ' on ' + formatOrderDate(order.createdAt);
}
`,
};

function scenario(patches: Record<string, string>[]) {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH);
  for (const p of ['src', 'tests', 'scripts', 'vitest.config.ts', 'vitest.integration.config.ts']) {
    cpSync(join(ROOT, p), join(SCRATCH, p), { recursive: true });
  }
  for (const patch of patches) for (const [file, text] of Object.entries(patch)) writeFileSync(join(SCRATCH, file), text);
  const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: SCRATCH, encoding: 'utf8' }).status === 0;
  return {
    integration: run('npx', ['vitest', 'run', '--config', 'vitest.integration.config.ts']),
    dupes: run('npx', ['tsx', 'scripts/check-dupes.ts']),
  };
}

const cases = [
  { name: 'baseline', patches: [], want: { integration: false, dupes: true } },
  { name: 'A + B without Contract', patches: [A, B_ALONE], want: { integration: false, dupes: false } },
  { name: 'A + B with Contract', patches: [A, B_CONTRACT], want: { integration: true, dupes: true } },
  { name: 'A + B with a thin wrapper', patches: [A, B_WRAPPER], want: { integration: true, dupes: true } },
];

let failed = 0;
try {
  for (const c of cases) {
    const got = scenario(c.patches);
    const ok = got.integration === c.want.integration && got.dupes === c.want.dupes;
    if (!ok) failed++;
    const word = (b: boolean) => (b ? 'pass' : 'fail');
    console.log(`${ok ? 'ok  ' : 'BAD '} ${c.name}: integration ${word(got.integration)}, check-dupes ${word(got.dupes)}`);
  }
} finally {
  rmSync(SCRATCH, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
