import type { Hex } from "viem";

/**
 * The salt + plaintext never touch the chain until reveal, so they live here.
 * Lose the receipt and the prediction can never be revealed — it stays sealed
 * forever and counts against you as file-drawer. Hence the export button.
 */
export interface Receipt {
  author: string;
  id: number;
  plaintext: string;
  salt: Hex;
  txHash?: string;
  sealedAt: number;
}

const PREFIX = "priori:";
const key = (author: string, id: number) => `${PREFIX}${author.toLowerCase()}:${id}`;

export function saveReceipt(r: Receipt): void {
  localStorage.setItem(key(r.author, r.id), JSON.stringify(r));
}

export function loadReceipt(author: string, id: number): Receipt | null {
  const raw = localStorage.getItem(key(author, id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Receipt;
  } catch {
    return null;
  }
}

export function allReceipts(author: string): Receipt[] {
  const out: Receipt[] = [];
  const scope = `${PREFIX}${author.toLowerCase()}:`;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(scope)) continue;
    try {
      out.push(JSON.parse(localStorage.getItem(k)!) as Receipt);
    } catch {
      /* skip corrupt entry */
    }
  }
  return out.sort((a, b) => a.id - b.id);
}

export function exportReceipts(author: string): string {
  return JSON.stringify({ author, receipts: allReceipts(author) }, null, 2);
}

export function importReceipts(json: string): number {
  const parsed = JSON.parse(json);
  const receipts: Receipt[] = parsed.receipts ?? parsed;
  let n = 0;
  for (const r of receipts) {
    if (r && typeof r.id === "number" && r.author && r.plaintext && r.salt) {
      saveReceipt(r);
      n++;
    }
  }
  return n;
}
