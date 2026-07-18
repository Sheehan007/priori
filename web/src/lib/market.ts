/** Real OHLC candles from Coinbase Exchange's public API (keyless, CORS-open). */

export interface Candle {
  t: number; // unix seconds, bar open
  low: number;
  high: number;
  open: number;
  close: number;
  volume: number;
}

const BASE = "https://api.exchange.coinbase.com";

export const PRODUCTS = ["BTC-USD", "ETH-USD", "SOL-USD", "LINK-USD", "AVAX-USD"];

/** Granularities Coinbase supports, in seconds. */
export const GRANULARITIES = [
  { value: 60, label: "1 minute" },
  { value: 300, label: "5 minutes" },
  { value: 900, label: "15 minutes" },
  { value: 3600, label: "1 hour" },
  { value: 86400, label: "1 day" },
];

/**
 * Fetch candles covering [start, end]. Coinbase returns at most 300 bars and
 * orders them newest-first, so we sort ascending for the backtest.
 */
export async function fetchCandles(
  symbol: string,
  granularity: number,
  start: number,
  end: number,
): Promise<Candle[]> {
  const url = new URL(`${BASE}/products/${symbol}/candles`);
  url.searchParams.set("granularity", String(granularity));
  url.searchParams.set("start", new Date(start * 1000).toISOString());
  url.searchParams.set("end", new Date(end * 1000).toISOString());

  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Coinbase API ${res.status}: ${await res.text()}`);

  const raw = (await res.json()) as number[][];
  if (!Array.isArray(raw)) throw new Error("Unexpected candle payload");

  return raw
    .map((r) => ({ t: r[0], low: r[1], high: r[2], open: r[3], close: r[4], volume: r[5] }))
    .sort((a, b) => a.t - b.t);
}
