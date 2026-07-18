import { useState } from "react";
import type { BacktestResult } from "../lib/backtest";
import { parseHypothesis } from "../lib/hypothesis";
import type { Receipt } from "../lib/storage";

export interface ChainPrediction {
  commitHash: string;
  sealedAt: bigint;
  evaluateAfter: bigint;
  revealedAt: bigint;
  hit: boolean;
  metricBps: number;
  label: string;
  plaintext: string;
}

export interface VerifyOutcome {
  ok: boolean;
  recomputedBps: number;
  claimedBps: number;
  recomputedHit: boolean;
  claimedHit: boolean;
  error?: string;
}

interface Props {
  index: number;
  p: ChainPrediction;
  receipt: Receipt | null;
  onReveal: (index: number) => Promise<void>;
  onVerify: (index: number) => Promise<VerifyOutcome>;
  onProveLock: (index: number) => Promise<string>;
}

const pct = (bps: number) => `${bps >= 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;

function countdown(until: number): string {
  const s = until - Math.floor(Date.now() / 1000);
  if (s <= 0) return "window closed";
  if (s < 60) return `${s}s left`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s left`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m left`;
  return `${Math.floor(s / 86400)}d left`;
}

export function PredictionCard({ index, p, receipt, onReveal, onVerify, onProveLock }: Props) {
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState<VerifyOutcome | null>(null);
  const [lockProof, setLockProof] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const now = Math.floor(Date.now() / 1000);
  const evaluateAfter = Number(p.evaluateAfter);
  const revealed = p.revealedAt !== 0n;
  const windowClosed = now >= evaluateAfter;

  let status: "pending" | "ready" | "abandoned" | "hit" | "miss";
  if (revealed) status = p.hit ? "hit" : "miss";
  else if (!windowClosed) status = "pending";
  else if (receipt) status = "ready";
  else status = "abandoned";

  const statusLabel = {
    pending: "sealed",
    ready: "ready to reveal",
    abandoned: "file drawer",
    hit: "hit",
    miss: "miss",
  }[status];

  const pillClass = status === "ready" ? "pending" : status;
  const hypothesis = revealed ? parseHypothesis(p.plaintext) : null;

  async function doReveal() {
    setBusy(true);
    setErr(null);
    try {
      await onReveal(index);
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doVerify() {
    setBusy(true);
    setErr(null);
    try {
      setVerify(await onVerify(index));
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doProveLock() {
    setBusy(true);
    setErr(null);
    try {
      setLockProof(await onProveLock(index));
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`card ${status}`}>
      <div className="card-top">
        <span className="card-title">{p.label}</span>
        <span className={`pill ${pillClass}`}>{statusLabel}</span>
      </div>

      <div className="kv">
        <div>
          <span>sealed</span>
          <b>{new Date(Number(p.sealedAt) * 1000).toLocaleString()}</b>
        </div>
        <div>
          <span>window</span>
          <b>{revealed || windowClosed ? "closed" : countdown(evaluateAfter)}</b>
        </div>
        {revealed && (
          <>
            <div>
              <span>realized</span>
              <b className={p.metricBps >= 0 ? "pos" : "neg"}>{pct(p.metricBps)}</b>
            </div>
            <div>
              <span>claim met</span>
              <b className={p.hit ? "pos" : "neg"}>{p.hit ? "yes" : "no"}</b>
            </div>
          </>
        )}
      </div>

      {!revealed && (
        <div className="hint mono" style={{ wordBreak: "break-all" }}>
          commit {p.commitHash.slice(0, 22)}…
        </div>
      )}

      {revealed && hypothesis && (
        <div className="hint">
          {hypothesis.strategy} · {hypothesis.symbol} · lookback {hypothesis.lookback} · claimed ≥{" "}
          {pct(hypothesis.thresholdBps)}
          {hypothesis.note && <> · “{hypothesis.note}”</>}
        </div>
      )}

      {status === "abandoned" && (
        <div className="hint">
          Window closed with no reveal. Counts against the track record — the receipt for this
          seal isn’t in this browser.
        </div>
      )}

      {verify && (
        <div className={`verify ${verify.ok ? "ok" : "bad"}`}>
          {verify.error ? (
            <>Could not verify: {verify.error}</>
          ) : verify.ok ? (
            <>
              ✓ Independently recomputed {pct(verify.recomputedBps)} from public price data —
              matches the onchain claim.
            </>
          ) : (
            <>
              ✗ Mismatch. Onchain claim {pct(verify.claimedBps)} ({verify.claimedHit ? "hit" : "miss"}),
              recomputed {pct(verify.recomputedBps)} ({verify.recomputedHit ? "hit" : "miss"}).
            </>
          )}
        </div>
      )}

      {lockProof && (
        <div className={`verify ${lockProof.includes("TooEarlyToReveal") ? "ok" : "bad"}`}>
          {lockProof.includes("TooEarlyToReveal") ? (
            <>
              ✓ The contract refused the reveal — reverted with{" "}
              <b className="mono">TooEarlyToReveal</b>. The lock is enforced onchain, not by this
              interface.
            </>
          ) : (
            <>Contract response: <span className="mono">{lockProof}</span></>
          )}
        </div>
      )}

      {err && <div className="verify bad">{err}</div>}

      <div className="actions">
        {status === "ready" && (
          <button className="primary sm" disabled={busy} onClick={doReveal}>
            {busy ? "Evaluating…" : "Evaluate & reveal"}
          </button>
        )}
        {revealed && (
          <button className="sm" disabled={busy} onClick={doVerify}>
            {busy ? "Verifying…" : "Verify independently"}
          </button>
        )}
        {status === "pending" && (
          <>
            <button className="sm" disabled={busy || !receipt} onClick={doProveLock}>
              {busy ? "Asking the contract…" : "Try revealing early"}
            </button>
            <span className="hint">Don’t trust the countdown — make the contract prove it.</span>
          </>
        )}
      </div>
    </div>
  );
}
