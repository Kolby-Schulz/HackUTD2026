export function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function total(items) {
  return items.reduce((sum, i) => sum + i.priceCents * i.qty, 0);
}

function helper() {
  return 1;
}
