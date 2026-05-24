import { describe, expect, test } from "vitest";
import { buildPeerPerformanceRows } from "./peer-rankings";

describe("buildPeerPerformanceRows", () => {
  test("calculates full-market peer average, rank, total, and percentile for each period", () => {
    const rows = buildPeerPerformanceRows(
      { code: "000001", type: "混合型", near_1m: 8, near_3m: 12, near_6m: -3, near_1y: 20 },
      [
        { code: "000001", type: "混合型", near_1m: 8, near_3m: 12, near_6m: -3, near_1y: 20 },
        { code: "000002", type: "混合型", near_1m: 10, near_3m: 11, near_6m: -1, near_1y: 30 },
        { code: "000003", type: "混合型", near_1m: 6, near_3m: 20, near_6m: -8, near_1y: 10 },
        { code: "000004", type: "股票型", near_1m: 99, near_3m: 99, near_6m: 99, near_1y: 99 },
      ]
    );

    expect(rows.find((row) => row.key === "return1m")).toMatchObject({
      value: 8,
      peerAverage: 8,
      rank: 2,
      total: 3,
      percentile: 66.67,
    });
    expect(rows.find((row) => row.key === "return3m")).toMatchObject({
      peerAverage: 14.33,
      rank: 2,
      total: 3,
    });
    expect(rows.find((row) => row.key === "return6m")).toMatchObject({
      rank: 2,
      total: 3,
    });
  });

  test("falls back to matching mapped fund type when Chinese category is missing", () => {
    const rows = buildPeerPerformanceRows(
      { code: "159732", mappedType: "etf", near_1m: 5 },
      [
        { code: "159732", mappedType: "etf", near_1m: 5 },
        { code: "159901", mappedType: "etf", near_1m: 6 },
        { code: "000001", mappedType: "hybrid", near_1m: 100 },
      ]
    );

    expect(rows.find((row) => row.key === "return1m")).toMatchObject({
      rank: 2,
      total: 2,
      percentile: 100,
    });
  });
});
