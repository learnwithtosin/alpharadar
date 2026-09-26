# onchain-analyst

Read-only Solana memecoin wallet research. Never connects a wallet, signs, or trades.

Run each token in its own working directory (cache, prices and outputs land there):

```
export PYTHONPATH=/path/to/onchain-analyst
python -m pool <pool_address> <token_mint>        # stage 1a: rebuild every swap → trades.json
python -m agg --pump-ts <unix_ts>                 # stage 1b/2: rank by %PnL, flag clusters/infra → candidates.json
python -m funders <wallet> ...                    # stage 2: first funder, tx/day (bot check), shared txs
python -m summ --cap 500 <wallet> ...             # stage 3 first pass (latest 500 txs)
python -m summ <wallet> ...                       # stage 3 full 30 days
```

Data sources: Helius when `HELIUS_API_KEY` is set (parsed-transaction API, 100 tx per
request; batched JSON-RPC), else public RPCs (api.mainnet-beta for full history, Tatum as
backup). Prices: GeckoTerminal OHLCV; pairs: DexScreener.

The key is read only from the environment and redacted from errors. Every response is cached
under `./cache/` and never re-fetched; `usage.json` counts requests and estimated Helius credits
(`python -c "import rpc; print(rpc.usage_report())"`). Credit weights in `rpc.CREDITS` are
estimates — confirm against the Helius dashboard.
