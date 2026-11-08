# demo-repo

Small TypeScript billing app with two planted conflicts (spec section 14).
Owner: coordinator + mapper. It is kept outside the npm workspaces on purpose, so worker
agents can run its tests in their own git worktrees (`.worktrees/<agent-id>/demo-repo`).
It has no runtime dependencies. `vitest`, `tsx` and `typescript` come from the monorepo's
root `node_modules`, so a fresh worktree needs no `npm install`.

## Layout

| File | What it is |
| --- | --- |
| `src/models.ts` | `LineItem`, `Cart`, `Order`, `Invoice` types |
| `src/billing/fees.ts` | `calculateFee(amountCents: number): number`, 2.5%, **rounds down** today |
| `src/billing/invoice.ts` | `subtotal(items)`, `buildInvoice(order)`; uses `calculateFee` |
| `src/checkout/checkout.ts` | `computeTotal(cart)`; uses `calculateFee` |
| `tests/*.test.ts` | Unit tests (current behavior) |
| `tests/integration.test.ts` | End-to-end judge: half-up fees, invoice total == checkout total, a `*receipt*` export in `src/checkout/` showing the total and `Nov 7, 2026`, the invoice showing the due date |
| `scripts/check-dupes.ts` | Fails if `src/` has more than one date-formatting function |
| `scripts/selftest.ts` | Applies hand-written agent solutions and proves both conflicts fire |

## Scripts

| Command | Baseline result |
| --- | --- |
| `npm test` | green (unit tests only) |
| `npm run test:integration` | **red by design**: these are the two tasks' goals; run after merging both agents |
| `npm run check:dupes` | green (0 date formatters) |
| `npm run selftest` | green: baseline, A+B without InSync (both checks fail), A+B with InSync (both pass) |
| `npm run typecheck` | green |

## The two tasks and the planted conflicts

- **Task 1 (agent A):** "Add late fees to invoices. Fees must round half-up to the cent. Show the
  due date on the invoice formatted like `Nov 7, 2026`."
- **Task 2 (agent B):** "Add a receipt to checkout showing the total with fees and the order date
  formatted like `Nov 7, 2026`."

1. **Changed behavior.** A changes `calculateFee` to round half-up. B, unaware, rounds the fee
   itself for the receipt, so `integration.test.ts` fails by one cent on a 1020¢ order.
   With InSync, Rule 1 fires on A's `report_change` (B depends on `calculateFee`, and
   `computeTotal → calculateFee` is a call edge).
2. **Duplicate helper.** No date formatter exists, so each agent writes one
   (e.g. `formatDate` and `toDisplayDate`), and `check-dupes` fails. With InSync, Rule 2 fires
   on B's plan and B reuses A's helper.

Test dates are built with `Date.UTC`, so formatters should use `timeZone: 'UTC'`.

## Rules for agents

Do not edit `tests/integration.test.ts` or anything in `scripts/`. They are the judge.
