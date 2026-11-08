// An entry module: imports, no exports. Everything at the top level is the page's surface.
import { formatCents, total } from "./lib.js";

const cart = { items: [{ name: "Widget", priceCents: 1999, qty: 2 }] };

function renderTotal(items) {
  document.querySelector("#total").textContent = formatCents(total(items));
}

function checkTotals() {
  renderTotal(cart.items);
}

class Page {
  refresh() {
    checkTotals();
  }
}

document.querySelector("#recalc").addEventListener("click", checkTotals);
checkTotals();
