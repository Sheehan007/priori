import type { Candle } from "./market";
import type { Hypothesis } from "./hypothesis";

export interface BacktestResult {
  strategyReturnBps: number;
  benchmarkReturnBps: number; // buy & hold over the same window
  barsEvaluated: number;
  timeInMarketPct: number;
  maxDrawdownBps: number;
  hit: boolean; // strategyReturnBps >= thresholdBps
  firstClose: number;
  lastClose: number;
}

function sma(values: number[], n: number, i: number): number | null {
  if (i + 1 < n) return null;
  let sum = 0;
  for (let k = i - n + 1; k <= i; k++) sum += values[k];
  return sum / n;
}

function stdev(values: number[], n: number, i: number, mean: number): number {
  let sum = 0;
  for (let k = i - n + 1; k <= i; k++) sum += (values[k] - mean) ** 2;
  return Math.sqrt(sum / n);
}

/**
 * Deterministic evaluation of a sealed hypothesis.
 *
 * Position for bar i is decided using ONLY data up to bar i-1, then applied to
 * the i-1 -> i return. No lookahead: that is the whole point of this tool.
 */
export function runBacktest(h: Hypothesis, candles: Candle[]): BacktestResult {
  const closes = candles.map((c) => c.close);

  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  let bars = 0;
  let inMarketBars = 0;
  let firstClose: number | null = null;
  let lastClose = 0;

  for (let i = 1; i < candles.length; i++) {
    const bar = candles[i];
    if (bar.t < h.windowStart || bar.t > h.windowEnd) continue;

    const prev = closes[i - 1];
    const cur = closes[i];
    if (prev <= 0) continue;
    if (firstClose === null) firstClose = prev;
    lastClose = cur;

    const barReturn = cur / prev - 1;

    let position = 0;
    if (h.strategy === "buy-hold") {
      position = 1;
    } else if (h.strategy === "sma-momentum") {
      const mean = sma(closes, h.lookback, i - 1);
      position = mean !== null && prev > mean ? 1 : 0;
    } else if (h.strategy === "mean-reversion") {
      const mean = sma(closes, h.lookback, i - 1);
      if (mean !== null) {
        const sd = stdev(closes, h.lookback, i - 1, mean);
        const z = sd > 0 ? (prev - mean) / sd : 0;
        position = z < -1 ? 1 : 0;
      }
    }

    equity *= 1 + position * barReturn;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak > 0 ? 1 - equity / peak : 0);
    inMarketBars += position;
    bars++;
  }

  const strategyReturnBps = Math.round((equity - 1) * 10_000);
  const benchmarkReturnBps =
    firstClose !== null && firstClose > 0 ? Math.round((lastClose / firstClose - 1) * 10_000) : 0;

  return {
    strategyReturnBps,
    benchmarkReturnBps,
    barsEvaluated: bars,
    timeInMarketPct: bars ? Math.round((inMarketBars / bars) * 100) : 0,
    maxDrawdownBps: Math.round(maxDd * 10_000),
    hit: strategyReturnBps >= h.thresholdBps,
    firstClose: firstClose ?? 0,
    lastClose,
  };
}

/** Bars of history needed before the window so the indicator is warm at bar 0. */
export function warmupSeconds(h: Hypothesis): number {
  if (h.strategy === "buy-hold") return h.granularity * 2;
  return h.granularity * (h.lookback + 2);
}
