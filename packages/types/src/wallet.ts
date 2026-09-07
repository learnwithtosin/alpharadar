/**
 * Mirrors the WalletSignalType enum in packages/database/prisma/schema.prisma.
 *
 * Per docs/decisions/0005-wallet-reputation-deferred.md, wallet reputation
 * scoring does not exist in the MVP. The only signal type is a factual
 * "this tracked wallet interacted with this contract" observation — no
 * wallet is ever labelled "smart". Extend this list only when a new
 * reputation signal is deliberately built, not speculatively.
 */
export const WALLET_SIGNAL_TYPES = ["EARLY_INTERACTION"] as const;

export type WalletSignalType = (typeof WALLET_SIGNAL_TYPES)[number];

export function isWalletSignalType(value: string): value is WalletSignalType {
  return (WALLET_SIGNAL_TYPES as readonly string[]).includes(value);
}
