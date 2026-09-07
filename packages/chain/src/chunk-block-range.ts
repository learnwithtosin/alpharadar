export interface BlockRange {
  fromBlock: bigint;
  toBlock: bigint;
}

/**
 * Splits [fromBlock, toBlock] (inclusive) into consecutive windows of at
 * most chunkSize blocks each. Confirmed necessary against live Robinhood
 * Chain RPC: an unfiltered eth_getLogs over as little as 1000 blocks can
 * exceed the node's 50,000-matched-log cap, and the shared public RPC is
 * rate limited — chunking bounds both the per-call result size and the
 * request rate (see RobinhoodAdapter.getLogs).
 */
export function chunkBlockRange(
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize: bigint,
): BlockRange[] {
  if (chunkSize <= 0n) {
    throw new RangeError("chunkSize must be positive");
  }
  if (fromBlock > toBlock) {
    return [];
  }

  const chunks: BlockRange[] = [];
  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + chunkSize - 1n < toBlock ? start + chunkSize - 1n : toBlock;
    chunks.push({ fromBlock: start, toBlock: end });
    start = end + 1n;
  }
  return chunks;
}
