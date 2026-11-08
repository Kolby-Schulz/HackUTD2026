import type { LineItem } from '../models';
import { calculateFee } from './fees';
import { formatMoney } from '../util/format';

interface Totals {
  subtotal: number;
  fee: number;
}

export abstract class Document {
  abstract title(): string;
}

export class Invoice extends Document implements Totals {
  subtotal = 0;
  fee = 0;
  #secret = 1;

  constructor(private readonly items: LineItem[]) {
    super();
    this.subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    this.fee = calculateFee(this.subtotal);
  }

  title(): string {
    return 'Invoice';
  }

  total(): number {
    return this.subtotal + this.fee;
  }

  render = (): string => formatMoney(this.total());

  static empty(): Invoice {
    return new Invoice([]);
  }

  #hidden(): number {
    return this.#secret;
  }

  get count(): number {
    return this.items.length + this.#hidden();
  }
}

export function buildInvoice(items: LineItem[]): Invoice {
  return new Invoice(items);
}
