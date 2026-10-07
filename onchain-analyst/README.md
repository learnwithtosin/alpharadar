# onchain-analyst

Read-only Solana memecoin wallet research. Never connects a wallet, signs, or trades.

Run each token in its own working directory (cache, prices and outputs land there):

```
export PYTHONPATH=/path/to/onchain-analyst
python -m pool <token_mint> <pool> [<pool> ...]   # stage 1a: rebuild swaps (bonding curve + AMM) → trades.json
python -m agg --pump-ts <unix_ts>                 # stage 1b/2: rank by %PnL, flag clusters/infra → candidates.json
python -m funders <wallet> ...                    # stage 2: first funder, tx/day (bot check), shared txs
python -m summ --cap 500 <wallet> ...             # stage 3 first pass (latest 500 txs)
python -m summ <wallet> ...                       # stage 3 full 30 days
python -m overlap <main_mint> <main_max_mcap> <alt_max_mcap>   # main+alt runner: wallets early on BOTH
python -m screen activity <pool.json>             # patient-trader screen, stage A (1 credit/wallet)
python -m screen score activity.json              # stage B: 30d/7d win rate, hold, spread of profit; bar at top of screen.py
```

## Method that found the first Track wallet (Sep 27)

Pick a token that has run for 1–2 days, done 10–20x+ and reached $1–2M mcap. If it belongs to a
narrative with a main runner and an alt runner, look for wallets that got in early on **both**:

1. In the alt token's run dir: `pool` (pre-pump window only for bot-heavy pools), then `agg --last-mcap <now>`.
2. `overlap <main_mint> <main_max_mcap> <alt_max_mcap>` using the caller's entry mcaps as the ceilings.
3. `summ --cap 500 --days 14` on the matches, then full 30 days only for survivors.
4. Watch for "community bag" wallets: several matches holding the same other tokens is one crowd, not skill.

Bot-heavy pools (arbitrage floods): rebuild only the early window with `pool <mint> <curve> <pools...> --from <ts> --until <ts>`.
It pages the parsed API oldest-first filtered to SWAP (100 credits per ≤100 swaps), so failed txs and arb spam are skipped.
Pass the pump.fun bonding curve address too (from the mint's first tx); unlisted pools are treated as a SOL-quoted curve.

Data sources: Helius when `HELIUS_API_KEY` is set (parsed-transaction API, 100 tx per
request; batched JSON-RPC), else public RPCs (api.mainnet-beta for full history, Tatum as
backup). Prices: GeckoTerminal OHLCV; pairs: DexScreener.

The key is read only from the environment and redacted from errors. Every response is cached
under `./cache/` and never re-fetched; `usage.json` counts requests and estimated Helius credits
(`python -c "import rpc; print(rpc.usage_report())"`). Credit weights in `rpc.CREDITS` were
checked against the Helius dashboard: parsed-transaction API 100/call, standard RPC 1/call.
