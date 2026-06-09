import { describe, expect, test } from "vitest";
import {
  backendReturnSeries,
  chartDateTick,
  navPointsToReturnSeries,
  resolveFundReturnSeries,
} from "../src/lib/fund-detail-chart";

describe("fund detail chart helpers", () => {
  test("keeps full dates when deriving returns from nav history", () => {
    const result = navPointsToReturnSeries([
      { d: "2025-06-02", nav: 2 },
      { d: "2026-06-02", nav: 3 },
    ]);

    expect(result.data).toEqual([
      { d: "2025-06-02", value: 0 },
      { d: "2026-06-02", value: 50 },
    ]);
    expect(result.rangeReturn).toBe(50);
  });

  test("prefers nav history over stale backend fund comparison series", () => {
    const result = resolveFundReturnSeries(
      [
        { d: "2026-06-01", nav: 3.3549 },
        { d: "2026-06-02", nav: 3.3712 },
      ],
      [
        { date: "2025-12-11", return: 40 },
        { date: "2025-12-12", return: 38 },
      ],
    );

    expect(result.data.map((point) => point.d)).toEqual(["2026-06-01", "2026-06-02"]);
    expect(result.data.at(-1)?.value).toBeCloseTo(0.4859, 4);
  });

  test("uses backend series only when nav history is unavailable", () => {
    expect(backendReturnSeries([{ date: "2025-12-12", return: 38 }])).toEqual({
      data: [{ d: "2025-12-12", value: 38 }],
      rangeReturn: 38,
    });
    expect(resolveFundReturnSeries([], [{ date: "2025-12-12", return: 38 }])).toEqual({
      data: [{ d: "2025-12-12", value: 38 }],
      rangeReturn: 38,
    });
  });

  test("formats full dates for compact axis ticks", () => {
    expect(chartDateTick("2026-06-02")).toBe("06-02");
    expect(chartDateTick("06-02")).toBe("06-02");
  });
});
