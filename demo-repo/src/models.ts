// Shared billing types.

export interface LineItem {
  sku: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
}

export interface Cart {
  items: LineItem[];
}

export interface Order {
  id: string;
  customerId: string;
  items: LineItem[];
  createdAt: Date;
  dueDate: Date;
}

export interface InvoiceLine {
  description: string;
  amountCents: number;
}

export interface Invoice {
  orderId: string;
  lines: InvoiceLine[];
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
}
