import { describe, expect, test } from "vitest";
import { mapBacktestResult } from "./mapper";

describe("mapBacktestResult", () => {
  test("does not count new DCA cashflows as portfolio return for Sharpe", () => {
    const result = mapBacktestResult(
      {
        individual: [
          {
            fund_code: "000001",
            strategies: {
              fixed: {
                total_invested: 3000,
                total_value: 3000,
                total_profit_rate: 0,
                annual_return: 0,
                max_drawdown: 0,
                sharpe_ratio: 0,
                nav_curve: [
                  { date: "2025-01-01", invested: 1000, value: 1000 },
                  { date: "2025-02-03", invested: 2000, value: 2000 },
                  { date: "2025-03-03", invested: 3000, value: 3000 },
                  { date: "2025-03-31", invested: 3000, value: 3000 },
                ],
                benchmark: {
                  total_invested: 3000,
                  curve: [
                    { date: "2025-01-01", value: 3000 },
                    { date: "2025-03-31", value: 3000 },
                  ],
                },
              },
            },
            benchmark: {
              total_invested: 3000,
              curve: [
                { date: "2025-01-01", value: 3000 },
                { date: "2025-03-31", value: 3000 },
              ],
            },
          },
        ],
      },
      { strategy: "compare", weights: [100] }
    );

    expect(result.sharpeRatio).toBe("0.00");
    expect(result.maxDrawdown).toBe("0.00");
    expect(result.strategyResults[0]).toMatchObject({ key: "fixed", sharpeRatio: "0.00" });
  });
});
