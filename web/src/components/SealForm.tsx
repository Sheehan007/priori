import { useMemo, useState } from "react";
import type { Hex } from "viem";
import {
  canonicalize,
  commitHash,
  randomSalt,
  STRATEGIES,
  type Hypothesis,
  type StrategyId,
} from "../lib/hypothesis";
import { PRODUCTS } from "../lib/market";

const HORIZONS = [
  { label: "10 minutes", seconds: 600, granularity: 60 },
  { label: "1 hour", seconds: 3600, granularity: 60 },
  { label: "6 hours", seconds: 21600, granularity: 300 },
  { label: "1 day", seconds: 86400, granularity: 900 },
  { label: "7 days", seconds: 604800, granularity: 3600 },
];

const nowSec = () => Math.floor(Date.now() / 1000);

interface Props {
  onSeal: (h: Hypothesis, label: string, salt: Hex, plaintext: string) => void;
  busy: boolean;
  disabled: boolean;
}

export function SealForm({ onSeal, busy, disabled }: Props) {
  const [strategy, setStrategy] = useState<StrategyId>("sma-momentum");
  const [symbol, setSymbol] = useState(PRODUCTS[0]);
  const [horizonIdx, setHorizonIdx] = useState(0);
  const [lookback, setLookback] = useState(20);
  const [thresholdBps, setThresholdBps] = useState(0);
  const [note, setNote] = useState("");
  const [label, setLabel] = useState("");
  const [draftNow, setDraftNow] = useState(nowSec);
  const [salt, setSalt] = useState<Hex>(randomSalt);

  const horizon = HORIZONS[horizonIdx];

  const hypothesis: Hypothesis = useMemo(
    () => ({
      v: 1,
      strategy,
      symbol,
      granularity: horizon.granularity,
      lookback: strategy === "buy-hold" ? 0 : lookback,
      windowStart: draftNow,
      windowEnd: draftNow + horizon.seconds,
      thresholdBps,
      note: note.trim(),
    }),
    [strategy, symbol, horizon, lookback, thresholdBps, note, draftNow],
  );

  const plaintext = useMemo(() => canonicalize(hypothesis), [hypothesis]);
  const hash = useMemo(() => commitHash(plaintext, salt), [plaintext, salt]);

  const autoLabel =
    label.trim() ||
    `${symbol} ${STRATEGIES.find((s) => s.id === strategy)!.name}${
      strategy === "buy-hold" ? "" : ` ${lookback}`
    }`;

  const windowEndsAt = new Date(hypothesis.windowEnd * 1000);
  const expired = hypothesis.windowEnd <= nowSec();

  function submit() {
    onSeal(hypothesis, autoLabel, salt, plaintext);
    // fresh salt + timestamps for the next draft
    setSalt(randomSalt());
    setDraftNow(nowSec());
  }

  return (
    <div>
      <div className="eyebrow">Step 1 — pre-register</div>
      <div className="h2">Seal a thesis</div>

      <div className="field">
        <label>Strategy</label>
        <select value={strategy} onChange={(e) => setStrategy(e.target.value as StrategyId)}>
          {STRATEGIES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="hint">{STRATEGIES.find((s) => s.id === strategy)!.blurb}</div>
      </div>

      <div className="row">
        <div className="field">
          <label>Market</label>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {PRODUCTS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Forward window</label>
          <select value={horizonIdx} onChange={(e) => setHorizonIdx(Number(e.target.value))}>
            {HORIZONS.map((h, i) => (
              <option key={h.label} value={i}>
                {h.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>Lookback (bars)</label>
          <input
            type="number"
            min={2}
            max={200}
            value={lookback}
            disabled={strategy === "buy-hold"}
            onChange={(e) => setLookback(Math.max(2, Number(e.target.value) || 2))}
          />
        </div>
        <div className="field">
          <label>Claim: return ≥ (bps)</label>
          <input
            type="number"
            value={thresholdBps}
            onChange={(e) => setThresholdBps(Number(e.target.value) || 0)}
          />
        </div>
      </div>

      <div className="field">
        <label>Public label (visible before reveal)</label>
        <input
          value={label}
          placeholder={autoLabel}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={60}
        />
        <div className="hint">Keep it vague enough not to leak the thesis.</div>
      </div>

      <div className="field">
        <label>Private note (sealed until reveal)</label>
        <textarea
          rows={2}
          value={note}
          placeholder="Why do you believe this?"
          onChange={(e) => setNote(e.target.value)}
          maxLength={280}
        />
      </div>

      <div className="commitment">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="eyebrow">Exactly what gets hashed</span>
          <div className="spacer" />
          <button
            className="ghost sm"
            onClick={() => setDraftNow(nowSec())}
            title="Re-stamp the window to start now"
          >
            ↻ restamp
          </button>
        </div>
        <pre>{plaintext}</pre>
        <div className="hashline">commit = {hash}</div>
        <div className="hint">
          Only this hash goes onchain. The thesis above stays in your browser until the window
          closes at <b className="mono">{windowEndsAt.toLocaleString()}</b>.
        </div>
      </div>

      {expired && (
        <div className="banner warn" style={{ marginTop: 12 }}>
          Window already elapsed — hit ↻ restamp before sealing.
        </div>
      )}

      <button
        className="primary"
        style={{ width: "100%", marginTop: 12 }}
        disabled={disabled || busy || expired}
        onClick={submit}
      >
        {busy ? "Sealing…" : "Seal onchain"}
      </button>
    </div>
  );
}
