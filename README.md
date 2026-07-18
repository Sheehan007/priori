# Priori

**Seal your thesis before the market answers.** Onchain pre-registration for trading strategies —
hindsight bias made structurally impossible.

> Built for the BuildAnything hackathon (Spark) on **Monad**.

---

## The problem (a real one I have)

I do quantitative research — portfolio optimization, VaR/CVaR engines, a limit-order-book
market-making simulator. Every one of those projects has the same failure mode, and it is
embarrassing precisely because it is invisible:

You run a backtest. The curve looks mediocre. You nudge the lookback from 20 to 50. You try a
different asset. You shift the window. Eventually something looks good — and then you write it up
as though that was the thesis all along.

That is p-hacking, and the reason it is so hard to catch is that **there is no record of what you
actually believed before you saw the result.** Your notebook is a file you control. Your git
history can be rewritten. Your memory is the least reliable of all. You cannot audit yourself,
because every artifact of your own process is one you can edit after the fact.

Science solved this with **pre-registration**: state the hypothesis, publicly and immutably,
*before* collecting data. Quant research has no equivalent.

## The solution

Priori is a commit-reveal registry on Monad.

1. **Seal.** Before the evaluation window opens, you write your hypothesis — strategy, market,
   parameters, the exact window, and the return threshold you're claiming. The app canonicalizes it
   to JSON, hashes it with a random salt, and writes **only the hash** onchain. The thesis itself
   stays in your browser.
2. **Wait.** The contract stores an `evaluateAfter` timestamp that **must be in the future** at seal
   time, and it refuses any reveal before that moment. You cannot run the test first and pretend you
   called it — the market decides after you've committed.
3. **Reveal.** Once the window closes, the app fetches the real candles for exactly the window you
   sealed, runs the strategy, and publishes the plaintext plus the realized return. The contract
   recomputes `keccak256(abi.encode(plaintext, salt))` and **rejects anything that doesn't match the
   original commitment.**
4. **Face the record.** Predictions whose window closed without a reveal are counted as
   **file drawer** — you cannot quietly bury the losers.

### Why this needs a blockchain

This is the narrow case where a database genuinely cannot substitute. The entire value is a
timestamp that **the author themselves cannot forge**. If Priori stored commitments in Postgres, I
own the Postgres — I could backdate a row and nobody, including future me, could prove otherwise.
Commit-reveal against an append-only public ledger is the mechanism, not the decoration.

## Trust model (stated plainly)

The realized metric is **self-reported at reveal time** — the contract verifies the *hypothesis*
wasn't altered, not that the arithmetic is honest. That is a real limitation and I'd rather write it
down than overclaim.

What makes it hold up anyway: the revealed plaintext fully specifies the evaluation (market,
granularity, lookback, exact window, threshold), so **anyone can recompute it**. The
**"Verify independently"** button in the UI does exactly that — refetches public candles, re-runs the
strategy, and flags any mismatch against the onchain claim. Cheating is possible; cheating
*undetectably* is not.

A future version could close this fully by pulling settlement prices from an onchain oracle.

## How the evaluation works

- Candles come from **Coinbase Exchange's public API** (keyless, CORS-open).
- Strategies: **SMA momentum**, **mean reversion** (1σ z-score), and **buy & hold** as the honest baseline.
- **No lookahead**: the position for bar *i* is decided using only data through bar *i−1*.
- Reported per prediction: strategy return (bps), buy-and-hold benchmark, bars evaluated, time in
  market, max drawdown.

Nothing is stubbed. A reveal number is computed from real prices at the moment you click.

## Contract

`contracts/Priori.sol` — Monad Testnet (chain ID **10143**)

| | |
|---|---|
| Address | [`0xfa5492E58095E9A25f6cc5d8E85F8f7bdE1a9ECA`](https://testnet.monadvision.com/address/0xfa5492E58095E9A25f6cc5d8E85F8f7bdE1a9ECA) |
| Deploy tx | [`0x181be4624b37ab950cd1c147d03bdf5b6996c80df81841f96810603f250ebdec`](https://testnet.monadvision.com/tx/0x181be4624b37ab950cd1c147d03bdf5b6996c80df81841f96810603f250ebdec) |
| Network | Monad Testnet (chain ID 10143) |

```solidity
seal(bytes32 commitHash, uint64 evaluateAfter, string label) returns (uint256 id)
reveal(uint256 id, string plaintext, bytes32 salt, bool hit, int32 metricBps)
stats(address author) returns (total, revealed, hits, abandoned, pending)
listAll(address author) returns (Prediction[])
```

Guarantees enforced onchain, each covered by a test:

| Rule | Error |
|---|---|
| Evaluation window must be in the future | `EvaluationMustBeFuture` |
| No reveal before the window closes | `TooEarlyToReveal` |
| Revealed thesis must match the sealed hash | `HashMismatch` |
| One reveal per prediction | `AlreadyRevealed` |

## Run it

```bash
git clone https://github.com/Sheehan007/priori && cd priori
npm install
npm test                 # 8 passing contract tests

# deploy (needs a funded testnet key in .env — see .env.example)
npm run deploy

# web app
cd web && npm install && npm run dev    # http://localhost:5180
```

Add Monad Testnet to MetaMask: RPC `https://testnet-rpc.monad.xyz`, chain ID `10143`, symbol `MON`.
Get gas at [faucet.monad.xyz](https://faucet.monad.xyz). The app will offer to add the network for you.

### Receipts

The salt and plaintext never touch the chain until reveal, so they live in `localStorage`. **Lose
them and the prediction can never be revealed** — it stays sealed forever and counts as file drawer.
Hence the export/import buttons. This is a deliberate consequence of the design, not an oversight.

## Stack

Solidity 0.8.24 · Hardhat · React + TypeScript + Vite · viem · Monad Testnet

## Layout

```
priori/
├─ contracts/Priori.sol      commit-reveal registry
├─ test/Priori.test.js       8 tests
├─ scripts/deploy.js         deploys + writes address/ABI for the frontend
└─ web/src/
   ├─ lib/hypothesis.ts      canonical JSON + keccak256 commitment (mirrors Solidity)
   ├─ lib/market.ts          Coinbase candles
   ├─ lib/backtest.ts        strategy evaluation, no lookahead
   ├─ lib/chain.ts           viem + Monad testnet
   └─ components/            seal form, prediction cards
```
