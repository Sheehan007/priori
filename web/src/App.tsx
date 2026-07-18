import { useCallback, useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { SealForm } from "./components/SealForm";
import {
  PredictionCard,
  type ChainPrediction,
  type VerifyOutcome,
} from "./components/PredictionCard";
import {
  CONTRACT_ADDRESS,
  IS_DEPLOYED,
  PRIORI_ABI,
  connect,
  currentAccount,
  explorerAddress,
  getWalletClient,
  hasWallet,
  publicClient,
  shortAddr,
} from "./lib/chain";
import { commitHash, parseHypothesis, type Hypothesis } from "./lib/hypothesis";
import { fetchCandles } from "./lib/market";
import { runBacktest, warmupSeconds } from "./lib/backtest";
import { exportReceipts, importReceipts, loadReceipt, saveReceipt } from "./lib/storage";

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
const clampInt32 = (n: number) => Math.max(INT32_MIN, Math.min(INT32_MAX, Math.round(n)));

export default function App() {
  const [account, setAccount] = useState<Address | null>(null);
  const [predictions, setPredictions] = useState<ChainPrediction[]>([]);
  const [stats, setStats] = useState<[bigint, bigint, bigint, bigint, bigint] | null>(null);
  const [sealing, setSealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // keep countdowns live
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async (who: Address | null) => {
    if (!who || !IS_DEPLOYED) return;
    try {
      const [list, s] = await Promise.all([
        publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: PRIORI_ABI as any,
          functionName: "listAll",
          args: [who],
        }) as Promise<any[]>,
        publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: PRIORI_ABI as any,
          functionName: "stats",
          args: [who],
        }) as Promise<[bigint, bigint, bigint, bigint, bigint]>,
      ]);
      setPredictions(
        list.map((p) => ({
          commitHash: p.commitHash,
          sealedAt: p.sealedAt,
          evaluateAfter: p.evaluateAfter,
          revealedAt: p.revealedAt,
          hit: p.hit,
          metricBps: Number(p.metricBps),
          label: p.label,
          plaintext: p.plaintext,
        })),
      );
      setStats(s);
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || String(e));
    }
  }, []);

  useEffect(() => {
    (async () => {
      const acct = await currentAccount();
      if (acct) {
        setAccount(acct);
        refresh(acct);
      }
    })();
    const eth = (window as any).ethereum;
    if (eth?.on) {
      const onAccounts = (accs: string[]) => {
        const a = (accs[0] as Address) ?? null;
        setAccount(a);
        setPredictions([]);
        refresh(a);
      };
      eth.on("accountsChanged", onAccounts);
      return () => eth.removeListener?.("accountsChanged", onAccounts);
    }
  }, [refresh]);

  async function doConnect() {
    setError(null);
    try {
      const a = await connect();
      setAccount(a);
      await refresh(a);
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || String(e));
    }
  }

  async function handleSeal(h: Hypothesis, label: string, salt: Hex, plaintext: string) {
    if (!account) return;
    setSealing(true);
    setError(null);
    try {
      const nextId = (await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: PRIORI_ABI as any,
        functionName: "count",
        args: [account],
      })) as bigint;

      const wallet = getWalletClient(account);
      const txHash = await wallet.writeContract({
        address: CONTRACT_ADDRESS,
        abi: PRIORI_ABI as any,
        functionName: "seal",
        args: [commitHash(plaintext, salt), BigInt(h.windowEnd), label],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      saveReceipt({
        author: account,
        id: Number(nextId),
        plaintext,
        salt,
        txHash,
        sealedAt: h.windowStart,
      });
      await refresh(account);
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || String(e));
    } finally {
      setSealing(false);
    }
  }

  /** Fetch real candles for the sealed window and evaluate the strategy. */
  async function evaluate(h: Hypothesis) {
    const candles = await fetchCandles(
      h.symbol,
      h.granularity,
      h.windowStart - warmupSeconds(h),
      h.windowEnd,
    );
    if (candles.length < 2) throw new Error("No price data returned for that window yet.");
    return runBacktest(h, candles);
  }

  async function handleReveal(index: number) {
    if (!account) return;
    const receipt = loadReceipt(account, index);
    if (!receipt) throw new Error("Receipt missing from this browser — cannot reveal.");
    const h = parseHypothesis(receipt.plaintext);
    if (!h) throw new Error("Stored hypothesis is unreadable.");

    const result = await evaluate(h);
    const wallet = getWalletClient(account);
    const txHash = await wallet.writeContract({
      address: CONTRACT_ADDRESS,
      abi: PRIORI_ABI as any,
      functionName: "reveal",
      args: [
        BigInt(index),
        receipt.plaintext,
        receipt.salt,
        result.hit,
        clampInt32(result.strategyReturnBps),
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    await refresh(account);
  }

  /** Recompute a revealed prediction from public data and compare to its onchain claim. */
  async function handleVerify(index: number): Promise<VerifyOutcome> {
    const p = predictions[index];
    const h = parseHypothesis(p.plaintext);
    if (!h) {
      return {
        ok: false,
        recomputedBps: 0,
        claimedBps: p.metricBps,
        recomputedHit: false,
        claimedHit: p.hit,
        error: "revealed payload is not a Priori hypothesis",
      };
    }
    const result = await evaluate(h);
    const recomputedBps = clampInt32(result.strategyReturnBps);
    return {
      ok: result.hit === p.hit && Math.abs(recomputedBps - p.metricBps) <= 5,
      recomputedBps,
      claimedBps: p.metricBps,
      recomputedHit: result.hit,
      claimedHit: p.hit,
    };
  }

  function download() {
    if (!account) return;
    const blob = new Blob([exportReceipts(account)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `priori-receipts-${account.slice(0, 8)}.json`;
    a.click();
  }

  function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((txt) => {
      try {
        const n = importReceipts(txt);
        setError(null);
        alert(`Imported ${n} receipt(s).`);
        refresh(account);
      } catch {
        setError("Could not read that receipt file.");
      }
    });
  }

  const [total, revealed, hits, abandoned, pending] = stats ?? [0n, 0n, 0n, 0n, 0n];
  const hitRate = Number(revealed) > 0 ? Math.round((Number(hits) / Number(revealed)) * 100) : null;

  return (
    <div className="app">
      <header className="header">
        <div className="wordmark">
          Pri<em>o</em>ri
        </div>
        <div className="tagline">
          Seal your thesis before the market answers. Hindsight bias, made structurally impossible.
        </div>
        <div className="spacer" />
        {IS_DEPLOYED && (
          <a
            className="chip"
            href={explorerAddress(CONTRACT_ADDRESS)}
            target="_blank"
            rel="noreferrer"
            title="Verified contract on Monad testnet"
          >
            {shortAddr(CONTRACT_ADDRESS)}
          </a>
        )}
        {account ? (
          <span className="chip">{shortAddr(account)}</span>
        ) : (
          <button className="primary" onClick={doConnect}>
            {hasWallet() ? "Connect wallet" : "Install MetaMask"}
          </button>
        )}
      </header>

      <div className="main">
        <aside className="compose">
          <SealForm onSeal={handleSeal} busy={sealing} disabled={!account || !IS_DEPLOYED} />
        </aside>

        <section className="record">
          {!IS_DEPLOYED && (
            <div className="banner err">
              Contract not deployed yet — run <span className="mono">npm run deploy</span>.
            </div>
          )}
          {error && <div className="banner err">{error}</div>}
          {!account && IS_DEPLOYED && (
            <div className="banner warn">
              Connect a wallet on Monad testnet to seal predictions and view your record.
            </div>
          )}

          <div className="stats">
            <div className="stat">
              <b>{String(total)}</b>
              <span>sealed</span>
            </div>
            <div className="stat">
              <b className="mono">{String(pending)}</b>
              <span>pending</span>
            </div>
            <div className="stat">
              <b>{String(revealed)}</b>
              <span>revealed</span>
            </div>
            <div className="stat">
              <b className={hitRate === null ? "" : hitRate >= 50 ? "pos" : "neg"}>
                {hitRate === null ? "—" : `${hitRate}%`}
              </b>
              <span>hit rate</span>
            </div>
            <div className="stat">
              <b className={Number(abandoned) > 0 ? "neg" : ""}>{String(abandoned)}</b>
              <span>file drawer</span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div className="eyebrow">Step 2 — the record</div>
            <div className="spacer" />
            {account && (
              <>
                <button className="ghost sm" onClick={download}>
                  Export receipts
                </button>
                <label className="chip" style={{ cursor: "pointer" }}>
                  Import
                  <input type="file" accept="application/json" hidden onChange={upload} />
                </label>
              </>
            )}
          </div>

          {predictions.length === 0 ? (
            <div className="empty">
              Nothing sealed yet.
              <br />
              <span style={{ fontSize: 12 }}>
                A prediction you never reveal still shows up here as file drawer — that’s the point.
              </span>
            </div>
          ) : (
            predictions
              .map((p, i) => ({ p, i }))
              .reverse()
              .map(({ p, i }) => (
                <PredictionCard
                  key={i}
                  index={i}
                  p={p}
                  receipt={account ? loadReceipt(account, i) : null}
                  onReveal={handleReveal}
                  onVerify={handleVerify}
                />
              ))
          )}
        </section>
      </div>
    </div>
  );
}
