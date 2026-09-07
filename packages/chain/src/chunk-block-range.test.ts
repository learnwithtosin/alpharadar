import { describe, expect, it } from "vitest";
import { chunkBlockRange } from "./chunk-block-range.js";

describe("chunkBlockRange", () => {
  it("returns a single chunk when the range fits within chunkSize", () => {
    expect(chunkBlockRange(100n, 150n, 1000n)).toEqual([{ fromBlock: 100n, toBlock: 150n }]);
  });

  it("splits an exact multiple of chunkSize with no remainder", () => {
    expect(chunkBlockRange(0n, 1999n, 1000n)).toEqual([
      { fromBlock: 0n, toBlock: 999n },
      { fromBlock: 1000n, toBlock: 1999n },
    ]);
  });

  it("gives the final chunk a shorter tail when the range isn't an exact multiple", () => {
    expect(chunkBlockRange(0n, 2500n, 1000n)).toEqual([
      { fromBlock: 0n, toBlock: 999n },
      { fromBlock: 1000n, toBlock: 1999n },
      { fromBlock: 2000n, toBlock: 2500n },
    ]);
  });

  it("returns a single-block chunk when fromBlock === toBlock", () => {
    expect(chunkBlockRange(42n, 42n, 1000n)).toEqual([{ fromBlock: 42n, toBlock: 42n }]);
  });

  it("returns an empty array when fromBlock > toBlock", () => {
    expect(chunkBlockRange(10n, 5n, 1000n)).toEqual([]);
  });

  it("throws on a non-positive chunkSize", () => {
    expect(() => chunkBlockRange(0n, 10n, 0n)).toThrow(RangeError);
    expect(() => chunkBlockRange(0n, 10n, -1n)).toThrow(RangeError);
  });

  it("handles chunkSize of 1 (every block its own chunk)", () => {
    expect(chunkBlockRange(5n, 7n, 1n)).toEqual([
      { fromBlock: 5n, toBlock: 5n },
      { fromBlock: 6n, toBlock: 6n },
      { fromBlock: 7n, toBlock: 7n },
    ]);
  });
});
