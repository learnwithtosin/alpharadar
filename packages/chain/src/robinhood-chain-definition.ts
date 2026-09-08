import { defineChain } from "viem";

/**
 * Robinhood Chain is not in viem's built-in chain list, so it's defined by
 * hand. Confirmed live: chainId 4663 via eth_chainId against
 * https://rpc.mainnet.chain.robinhood.com (returned 0x1237 = 4663). Native
 * currency is ETH — an Arbitrum Orbit chain settling to Ethereum, gas paid
 * in ETH (docs/spec/08-ENGINEERING-REVIEW-AND-CORRECTIONS.md §1), and
 * cross-checked against the Blockscout /v2/stats response (ETH coin icon,
 * ETH-range coin_price).
 */
export const ROBINHOOD_CHAIN_ID = 4663;

/**
 * The plain-string identifier used for every "chain" column in the
 * database (Contract.chain, Project.chain, Wallet.chain,
 * IngestionCheckpoint.chain, Opportunity.chain, ...). Those columns are
 * deliberately plain strings, not an enum, so 01 §17's future chain
 * adapters don't need a schema migration to add a value — this constant is
 * the single source of truth for Robinhood Chain's spelling, so every
 * writer uses the same string.
 */
export const ROBINHOOD_CHAIN_SLUG = "robinhood";

export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://robinhoodchain.blockscout.com",
      apiUrl: "https://robinhoodchain.blockscout.com/api",
    },
  },
});
