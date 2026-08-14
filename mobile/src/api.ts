import type { Merchant, ParseResult, Receipt, Summary } from './types';

const DEFAULT_API_URL = 'https://receipt.tail80ea1b.ts.net';

const envUrl = (process.env as Record<string, string | undefined>).EXPO_PUBLIC_API_URL;

export const API_URL = (envUrl && envUrl.trim() ? envUrl.trim() : DEFAULT_API_URL).replace(/\/+$/, '');

async function request<T>(path: string, init?: RequestInit, timeoutMs = 60000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}${path}`, { ...init, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function fetchReceipts(): Promise<Receipt[]> {
  return request<Receipt[]>('/api/receipts');
}

export function fetchSummary(): Promise<{ summary: Summary; updatedAt: string | null }> {
  return request<{ summary: Summary; updatedAt: string | null }>('/api/summary');
}

export function fetchMerchants(): Promise<{ merchants: Merchant[] }> {
  return request<{ merchants: Merchant[] }>('/api/merchants');
}

export function parseReceipt(payload: {
  filename: string;
  mimeType: string;
  data: string;
}): Promise<ParseResult> {
  return request<ParseResult>('/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 120000);
}

export function deleteReceipt(id: number): Promise<void> {
  return request<Record<string, never>>(`/api/receipts/${id}`, { method: 'DELETE' }, 30000).then(() => undefined);
}