import { describe, expect, test } from "vitest";
import { summarizeSavedReportSnapshot } from "@/lib/allocation-report-snapshot";

describe("summarizeSavedReportSnapshot", () => {
  test("empty response does not crash", () => {
    const s = summarizeSavedReportSnapshot({});
    expect(s.hasAllocation).toBe(false);
    expect(s.hasVariants).toBe(false);
    expect(s.hasDca).toBe(false);
    expect(s.hasBacktest).toBe(false);
    expect(s.metrics.fundCount).toBe(0);
    expect(s.warnings.length).toBeGreaterThan(0);
  });

  test("null/undefined response does not crash", () => {
    const s1 = summarizeSavedReportSnapshot(null);
    expect(s1.hasAllocation).toBe(false);
    const s2 = summarizeSavedReportSnapshot(undefined);
    expect(s2.hasAllocation).toBe(false);
  });

  test("hasVariants when variants exist", () => {
    const s = summarizeSavedReportSnapshot({
      variants: {
        defensive: { label: "defensive", label_cn: "防御型", risk_tolerance: "conservative", response: {} as any },
        balanced: { label: "balanced", label_cn: "均衡型", risk_tolerance: "balanced", response: {} as any },
      },
    });
    expect(s.hasVariants).toBe(true);
    expect(s.metrics.variantCount).toBe(2);
  });

  test("hasBacktest when backtestResult exists", () => {
    const s = summarizeSavedReportSnapshot({
      backtestResult: {
        metrics: {
          saa_taa: {
            annualized_return: 7.2,
            annualized_volatility: 12.5,
            max_drawdown: -15.3,
            sharpe_ratio: 1.35,
            sortino_ratio: 1.62,
            calmar_ratio: 0.47,
            monthly_win_rate: 58.3,
            max_drawdown_duration_days: 120,
            avg_turnover: 25,
            total_rebalances: 18,
            taa_value_added: 1.5,
          },
        },
        data_quality: {},
        curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
      },
    });
    expect(s.hasBacktest).toBe(true);
    expect(s.backtestMetrics.annualizedReturn).toBe("+7.20%");
    expect(s.backtestMetrics.annualizedVolatility).toBe("+12.50%");
    expect(s.backtestMetrics.maxDrawdown).toBe("-15.30%");
    expect(s.backtestMetrics.sharpe).toBe("1.35");
  });

  test("warning when no backtestResult", () => {
    const s = summarizeSavedReportSnapshot({ variants: { a: {} as any } });
    expect(s.warnings.some((w) => w.includes("策略回测"))).toBe(true);
    expect(s.hasBacktest).toBe(false);
  });

  test("hasDca when dca result exists", () => {
    const s = summarizeSavedReportSnapshot({
      dca_plan: { result: { totalInvested: 120000, finalValue: 145000, totalReturn: 20.83 } },
    });
    expect(s.hasDca).toBe(true);
    expect(s.dcaMetrics.totalInvested).toBe("120,000.00");
    expect(s.dcaMetrics.finalValue).toBe("145,000.00");
    expect(s.dcaMetrics.totalReturn).toBe("+20.83%");
  });

  test("hasDca when dcaResult exists", () => {
    const s = summarizeSavedReportSnapshot({
      dcaResult: { totalInvested: 100000, finalValue: 110000, totalReturn: 10 },
    });
    expect(s.hasDca).toBe(true);
  });

  test("fundCount from allocation funds", () => {
    const s = summarizeSavedReportSnapshot({
      funds: [
        { code: "000001", name: "A", weight: 30, amount: 150000 },
        { code: "000002", name: "B", weight: 70, amount: 350000 },
      ],
    });
    expect(s.hasAllocation).toBe(true);
    expect(s.metrics.fundCount).toBe(2);
  });

  test("percentages are not multiplied by 100 again", () => {
    const s = summarizeSavedReportSnapshot({
      saa: { expected_return: 7.2, expected_volatility: 12.5, expected_max_drawdown: -15.3, sharpe_ratio: 1.35 },
      backtestResult: {
        metrics: {
          saa_taa: { annualized_return: 7.2, annualized_volatility: 10, max_drawdown: -8, sharpe_ratio: 1.0, sortino_ratio: 1.2, calmar_ratio: 0.5, monthly_win_rate: 50, max_drawdown_duration_days: 90, avg_turnover: 20, total_rebalances: 12, taa_value_added: null },
        },
        data_quality: {}, curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
      },
    });
    expect(s.metrics.expectedReturn).toBe("+7.20%");
    expect(s.backtestMetrics.annualizedReturn).toBe("+7.20%");
    expect(s.backtestMetrics.annualizedReturn).not.toBe("+720.00%");
  });

  test("missing values show dash not zero", () => {
    const s = summarizeSavedReportSnapshot({ saa: {} });
    expect(s.metrics.expectedReturn).toBe("—");
    expect(s.metrics.volatility).toBe("—");
    expect(s.metrics.maxDrawdown).toBe("—");
    expect(s.metrics.sharpe).toBe("—");
  });

  test("output does not contain forbidden words", () => {
    const s = summarizeSavedReportSnapshot({
      funds: [{ code: "000001", name: "A", weight: 50, amount: 250000 }],
      saa: { expected_return: 5.5, expected_volatility: 10, expected_max_drawdown: -8, sharpe_ratio: 1.0 },
      backtestResult: {
        metrics: { saa_taa: { annualized_return: 5, annualized_volatility: 10, max_drawdown: -8, sharpe_ratio: 1.0, sortino_ratio: 1.2, calmar_ratio: 0.5, monthly_win_rate: 50, max_drawdown_duration_days: 90, avg_turnover: 20, total_rebalances: 12, taa_value_added: null } },
        data_quality: {}, curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
      },
      dca_plan: { result: { totalInvested: 100000, finalValue: 110000, totalReturn: 10 } },
    });
    const text = JSON.stringify(s);
    const forbidden = ["买入", "卖出", "下单", "交易", "自动调仓", "信号进入组合"];
    forbidden.forEach((w) => {
      expect(text).not.toContain(w);
    });
  });

  test("old snapshot missing fields shows correct warnings", () => {
    const s = summarizeSavedReportSnapshot({
      funds: [{ code: "000001", name: "A", weight: 50, amount: 250000 }],
      saa: { expected_return: 5 },
    });
    expect(s.warnings).toContain("旧快照缺少策略回测");
    expect(s.warnings).toContain("旧快照缺少多方案对比");
    expect(s.warnings).toContain("暂无定投结果");
    expect(s.hasBacktest).toBe(false);
    expect(s.hasVariants).toBe(false);
    expect(s.hasDca).toBe(false);
  });
});
