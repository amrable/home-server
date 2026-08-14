export interface ReceiptItem {
  name: string;
  quantity?: number | null;
  unit_price?: number | null;
  total?: number | null;
}

export interface TaxEntry {
  rate_percent?: number | null;
  amount?: number | null;
}

export interface ParsedReceipt {
  vendor?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  currency?: string | null;
  items?: ReceiptItem[];
  subtotal?: number | null;
  tax?: TaxEntry[];
  total?: number | null;
}

export interface Receipt {
  id: number;
  filename: string;
  mimeType: string;
  createdAt: string;
  merchant: string;
  parsed: ParsedReceipt;
}

export interface Merchant {
  key: string;
  name: string;
  aliases: string[];
  icon?: string;
}

export interface MerchantTotals {
  count: number;
  total: Record<string, number>;
}

export interface Summary {
  count: number;
  total: Record<string, number>;
  by_vendor: Record<string, { count: number; total: Record<string, number> }>;
  by_merchant: Record<string, MerchantTotals>;
  by_month: Record<string, number>;
}

export interface ParseResult {
  parsed: ParsedReceipt;
  merchant: string;
  id: number;
}