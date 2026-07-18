import { keccak256, encodeAbiParameters, parseAbiParameters, type Hex } from "viem";

export type StrategyId = "sma-momentum" | "mean-reversion" | "buy-hold";

export const STRATEGIES: { id: StrategyId; name: string; blurb: string }[] = [
  {
    id: "sma-momentum",
    name: "SMA momentum",
    blurb: "Long only while price is above its N-bar simple moving average.",
  },
  {
    id: "mean-reversion",
    name: "Mean reversion",
    blurb: "Long only when price is more than 1σ below its N-bar mean.",
  },
  { id: "buy-hold", name: "Buy & hold", blurb: "Always long. The honest baseline." },
];

/** Exactly what gets hashed and sealed onchain. Fully specifies the evaluation. */
export interface Hypothesis {
  v: 1;
  strategy: StrategyId;
  symbol: string;
  granularity: number; // seconds per bar
  lookback: number; // bars
  windowStart: number; // unix seconds
  windowEnd: number; // unix seconds — must equal the onchain evaluateAfter
  thresholdBps: number; // you claim strategy return >= this
  note: string;
}

// Fixed key order => byte-identical serialization on every machine.
const KEY_ORDER: (keyof Hypothesis)[] = [
  "v",
  "strategy",
  "symbol",
  "granularity",
  "lookback",
  "windowStart",
  "windowEnd",
  "thresholdBps",
  "note",
];

export function canonicalize(h: Hypothesis): string {
  const ordered: Record<string, unknown> = {};
  for (const k of KEY_ORDER) ordered[k] = h[k];
  return JSON.stringify(ordered);
}

/** Mirrors Priori.sol: keccak256(abi.encode(plaintext, salt)) */
export function commitHash(plaintext: string, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("string, bytes32"), [plaintext, salt]),
  );
}

export function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ("0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")) as Hex;
}

export function parseHypothesis(plaintext: string): Hypothesis | null {
  try {
    const o = JSON.parse(plaintext);
    if (o && o.v === 1 && typeof o.strategy === "string") return o as Hypothesis;
    return null;
  } catch {
    return null;
  }
}
