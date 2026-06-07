import { describe, expect, test } from "vitest";
import {
  inferAssetClass,
  analyzeCandidateMatch,
  analyzeCandidatePool,
  ASSET_CLASS_LABELS,
} from "@/lib/fund-research";

describe("inferAssetClass", () => {
  test("bond from type bond", () => {
    expect(inferAssetClass("bond", "某债券基金")).toBe("bond");
  });
  test("equity from type equity", () => {
    expect(inferAssetClass("equity", "某股票基金")).toBe("equity");
  });
  test("etf maps to equity", () => {
    expect(inferAssetClass("etf", "某ETF")).toBe("equity");
  });
  test("index maps to equity", () => {
    expect(inferAssetClass("index", "某指数基金")).toBe("equity");
  });
  test("money maps to cash", () => {
    expect(inferAssetClass("money", "某货币基金")).toBe("cash");
  });
  test("qdii maps to global", () => {
    expect(inferAssetClass("qdii", "某QDII")).toBe("global");
  });
  test("reits maps to alternative", () => {
    expect(inferAssetClass("reits", "某REITs")).toBe("alternative");
  });
  test("hybrid maps to hybrid", () => {
    expect(inferAssetClass("hybrid", "某混合基金")).toBe("hybrid");
  });
  test("unrecognized when no match", () => {
    expect(inferAssetClass("unknown", "某某某")).toBe("unrecognized");
  });
  test("keyword bond in name", () => {
    expect(inferAssetClass("", "信用债基金")).toBe("bond");
  });
  test("keyword gold in name", () => {
    expect(inferAssetClass("", "黄金ETF")).toBe("alternative");
  });
  test("keyword QDII in name", () => {
    expect(inferAssetClass("", "纳斯达克QDII")).toBe("global");
  });
});

describe("analyzeCandidateMatch", () => {
  const portfolio = [
    { code: "000001", name: "A基金", type: "equity", asset_class: "a_share_large", role: "core" },
    { code: "000002", name: "B基金", type: "bond", asset_class: "rate_bond", role: "stable" },
  ];

  test("same code → inPortfolio", () => {
    const candidate = {
      fundCode: "000001",
      fundName: "A基金",
      fundType: "equity",
      performance: { return1y: "10", maxDrawdown: "-5", sharpeRatio: "1.2" },
      feeManage: "0.015",
      totalScale: "50",
    };
    const result = analyzeCandidateMatch(candidate, portfolio);
    expect(result.inPortfolio).toBe(true);
    expect(result.suggestion).toContain("已在当前组合中");
    expect(result.dataStatus).toBe("ok");
  });

  test("missing key metrics → dataStatus missing", () => {
    const candidate = {
      fundCode: "000003",
      fundName: "C基金",
      fundType: "equity",
      performance: {},
      feeManage: null,
      totalScale: null,
    };
    const result = analyzeCandidateMatch(candidate, portfolio);
    expect(result.dataStatus).toBe("missing");
    expect(result.suggestion).toContain("数据不足");
    expect(result.inPortfolio).toBe(false);
  });

  test("sharpe missing but return present → partial", () => {
    const candidate = {
      fundCode: "000003",
      fundName: "C基金",
      fundType: "equity",
      performance: { return1y: "10", maxDrawdown: "-5" },
      feeManage: "0.015",
      totalScale: "20",
    };
    const result = analyzeCandidateMatch(candidate, portfolio);
    expect(result.dataStatus).toBe("partial");
    expect(result.suggestion).toContain("关键风险指标缺失");
  });

  test("new asset class not in portfolio → style supplement suggestion", () => {
    const candidate = {
      fundCode: "000003",
      fundName: "C基金",
      fundType: "qdii",
      performance: { return1y: "10", maxDrawdown: "-5", sharpeRatio: "1.2" },
      feeManage: "0.015",
      totalScale: "20",
    };
    const result = analyzeCandidateMatch(candidate, portfolio);
    expect(result.inferredAsset).toBe("global");
    expect(result.peerFunds.length).toBe(0);
    expect(result.suggestion).toContain("风格补充研究");
  });

  test("peer fund with same asset class", () => {
    const candidate = {
      fundCode: "000003",
      fundName: "C基金",
      fundType: "equity",
      performance: { return1y: "10", maxDrawdown: "-5", sharpeRatio: "1.2" },
      feeManage: "0.015",
      totalScale: "20",
    };
    const result = analyzeCandidateMatch(candidate, portfolio);
    expect(result.peerFunds.length).toBeGreaterThan(0);
    expect(result.peerFunds[0].code).toBe("000001");
  });

  test("low fee advantage", () => {
    const candidate = {
      fundCode: "000003",
      fundName: "C基金",
      fundType: "bond",
      performance: { return1y: "5", maxDrawdown: "-2", sharpeRatio: "0.8" },
      feeManage: "0.003",
      totalScale: "100",
    };
    const result = analyzeCandidateMatch(candidate, portfolio);
    expect(result.advantages).toContain("费率优势显著");
    expect(result.advantages).toContain("规模充足");
  });

  test("high sharpe advantage", () => {
    const candidate = {
      fundCode: "000003",
      fundName: "C基金",
      fundType: "equity",
      performance: { return1y: "10", maxDrawdown: "-5", sharpeRatio: "1.3" },
      feeManage: "0.015",
      totalScale: "20",
    };
    const result = analyzeCandidateMatch(candidate, portfolio);
    expect(result.advantages).toContain("Sharpe优秀");
  });

  test("unrecognized asset class suggestion", () => {
    const candidate = {
      fundCode: "000003",
      fundName: "C基金",
      fundType: "unknown_type",
      performance: { return1y: "10", maxDrawdown: "-5", sharpeRatio: "1.2" },
      feeManage: "0.015",
      totalScale: "20",
    };
    const result = analyzeCandidateMatch(candidate, portfolio);
    expect(result.inferredAsset).toBe("unrecognized");
    expect(result.suggestion).toContain("未识别");
  });
});

describe("analyzeCandidatePool", () => {
  test("returns empty for empty candidates", () => {
    const result = analyzeCandidatePool([], []);
    expect(result).toEqual([]);
  });

  test("maps multiple candidates", () => {
    const candidates = [
      { fundCode: "000001", fundName: "A", fundType: "equity", performance: { return1y: "10" }, feeManage: "0.015", totalScale: "50" },
      { fundCode: "000002", fundName: "B", fundType: "bond", performance: { return1y: "5" }, feeManage: "0.005", totalScale: "30" },
    ];
    const result = analyzeCandidatePool(candidates, []);
    expect(result.length).toBe(2);
    expect(result[0].match.inferredAsset).toBe("equity");
    expect(result[1].match.inferredAsset).toBe("bond");
  });
});

describe("ASSET_CLASS_LABELS", () => {
  test("has labels for all asset classes", () => {
    expect(ASSET_CLASS_LABELS.equity).toBe("权益类");
    expect(ASSET_CLASS_LABELS.bond).toBe("固收类");
    expect(ASSET_CLASS_LABELS.cash).toBe("现金类");
    expect(ASSET_CLASS_LABELS.alternative).toBe("另类");
    expect(ASSET_CLASS_LABELS.global).toBe("海外");
    expect(ASSET_CLASS_LABELS.hybrid).toBe("混合型");
    expect(ASSET_CLASS_LABELS.unrecognized).toBe("未识别");
  });
});

import { generateConstraintDraft } from "@/lib/fund-research";

describe("generateConstraintDraft", () => {
  const portfolio = [
    { code: "000001", name: "A基金", type: "equity", asset_class: "a_share_large", role: "core" },
    { code: "000002", name: "B基金", type: "bond", asset_class: "rate_bond", role: "stable" },
  ];

  test("same code → already_in_portfolio", () => {
    const candidate = {
      fundCode: "000001",
      fundName: "A基金",
      fundType: "equity",
      performance: { return1y: "10", maxDrawdown: "-5", sharpeRatio: "1.2" },
      feeManage: "0.015",
      totalScale: "50",
    };
    const result = generateConstraintDraft([candidate], portfolio);
    expect(result[0].action).toBe("already_in_portfolio");
    expect(result[0].priority).toBe("low");
    expect(result[0].constraints.some((c: string) => c.includes("已在组合中"))).toBe(true);
  });

  test("new asset class with full data → candidate_for_style_supplement", () => {
    const candidate = {
      fundCode: "000003",
      fundName: "C基金",
      fundType: "qdii",
      performance: { return1y: "10", maxDrawdown: "-5", sharpeRatio: "1.2" },
      feeManage: "0.015",
      totalScale: "20",
    };
    const result = generateConstraintDraft([candidate], portfolio);
    expect(result[0].action).toBe("candidate_for_style_supplement");
    expect(result[0].priority).toBe("high");
    expect(result[0].assetClassLabel).toBe("海外");
    expect(result[0].constraints.some((c: string) => c.includes("补充海外敞口"))).toBe(true);
  });

  test("peer with better sharpe and lower fee → candidate_for_peer_comparison", () => {
    const candidate = {
      fundCode: "000003",
      fundName: "C基金",
      fundType: "equity",
      performance: { return1y: "10", maxDrawdown: "-5", sharpeRatio: "1.3" },
      feeManage: "0.005",
      totalScale: "20",
    };
    const result = generateConstraintDraft([candidate], portfolio);
    expect(result[0].action).toBe("candidate_for_peer_comparison");
    expect(result[0].priority).toBe("medium");
    expect(result[0].constraints.some((c: string) => c.includes("同类替代观察"))).toBe(true);
  });

  test("missing key metrics → data_required", () => {
    const candidate = {
      fundCode: "000003",
      fundName: "C基金",
      fundType: "equity",
      performance: {},
      feeManage: null,
      totalScale: null,
    };
    const result = generateConstraintDraft([candidate], portfolio);
    expect(result[0].action).toBe("data_required");
    expect(result[0].priority).toBe("high");
    expect(result[0].constraints.some((c: string) => c.includes("关键指标缺失"))).toBe(true);
  });

  test("no advantage → watch_only", () => {
    const candidate = {
      fundCode: "000003",
      fundName: "C基金",
      fundType: "equity",
      performance: { return1y: "10", maxDrawdown: "-5", sharpeRatio: "0.3" },
      feeManage: "0.02",
      totalScale: "5",
    };
    const result = generateConstraintDraft([candidate], portfolio);
    expect(result[0].action).toBe("watch_only");
    expect(result[0].priority).toBe("low");
    expect(result[0].constraints.some((c: string) => c.includes("持续观察"))).toBe(true);
  });

  test("output does not contain forbidden words", () => {
    const candidate = {
      fundCode: "000003",
      fundName: "C基金",
      fundType: "equity",
      performance: { return1y: "10", maxDrawdown: "-5", sharpeRatio: "1.2" },
      feeManage: "0.015",
      totalScale: "20",
    };
    const result = generateConstraintDraft([candidate], portfolio);
    const text = JSON.stringify(result);
    const forbidden = ["买入", "卖出", "下单", "交易", "自动调仓", "信号进入组合"];
    forbidden.forEach((w) => {
      expect(text).not.toContain(w);
    });
  });

  test("missing values do not become 0", () => {
    const candidate = {
      fundCode: "000003",
      fundName: "C基金",
      fundType: "equity",
      performance: { return1y: null, maxDrawdown: null, sharpeRatio: null },
      feeManage: null,
      totalScale: null,
    };
    const result = generateConstraintDraft([candidate], portfolio);
    expect(result[0].dataStatus).toBe("missing");
    const text = JSON.stringify(result);
    expect(text).not.toContain('"0"');
    expect(text).not.toContain(":0,");
    expect(text).not.toContain(":0}");
  });

  test("asset class label is correct", () => {
    const candidate = {
      fundCode: "000003",
      fundName: "C基金",
      fundType: "bond",
      performance: { return1y: "5", maxDrawdown: "-2", sharpeRatio: "0.8" },
      feeManage: "0.005",
      totalScale: "100",
    };
    const result = generateConstraintDraft([candidate], portfolio);
    expect(result[0].assetClassLabel).toBe("固收类");
  });

  test("empty candidates return empty", () => {
    expect(generateConstraintDraft([], portfolio)).toEqual([]);
  });
});

import { generateResearchReportMarkdown } from "@/lib/fund-research";

describe("generateResearchReportMarkdown", () => {
  const portfolio = [
    { code: "000001", name: "A基金", type: "equity", asset_class: "a_share_large", role: "core" },
    { code: "000002", name: "B基金", type: "bond", asset_class: "rate_bond", role: "stable" },
  ];

  test("generates title 配置研究报告", () => {
    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [] });
    expect(md).toContain("# 配置研究报告");
    expect(md).toContain("生成时间：");
  });

  test("includes portfolio funds section", () => {
    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [] });
    expect(md).toContain("## 1. 当前组合基金");
    expect(md).toContain("A基金");
    expect(md).toContain("B基金");
  });

  test("includes candidate code and name", () => {
    const candidates = [
      { fundCode: "000003", fundName: "C基金", fundType: "equity", performance: { return1y: "10", maxDrawdown: "-5", sharpeRatio: "1.2" }, feeManage: "0.015", totalScale: "20" },
    ];
    const drafts = generateConstraintDraft(candidates, portfolio);
    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates, constraintDrafts: drafts });
    expect(md).toContain("## 2. 研究候选池");
    expect(md).toContain("000003");
    expect(md).toContain("C基金");
  });

  test("includes constraint drafts section with action label", () => {
    const candidates = [
      { fundCode: "000003", fundName: "C基金", fundType: "equity", performance: { return1y: "10", maxDrawdown: "-5", sharpeRatio: "1.2" }, feeManage: "0.015", totalScale: "20" },
    ];
    const drafts = generateConstraintDraft(candidates, portfolio);
    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates, constraintDrafts: drafts });
    expect(md).toContain("## 4. 配置约束草案");
    expect(md).toContain("同类替代观察");
  });

  test("shows 暂无研究候选 when empty", () => {
    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [] });
    expect(md).toContain("暂无研究候选");
  });

  test("shows 暂无配置约束草案 when empty", () => {
    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [] });
    expect(md).toContain("暂无配置约束草案");
  });

  test("missing values show dash not zero", () => {
    const candidates = [
      { fundCode: "000003", fundName: "C基金", fundType: "equity", performance: {}, feeManage: null, totalScale: null },
    ];
    const drafts = generateConstraintDraft(candidates, portfolio);
    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates, constraintDrafts: drafts });
    expect(md).toContain("—");
    expect(md).not.toContain(" 0%");
    expect(md).not.toContain(" 0.00");
  });

  test("escapes pipe characters in markdown tables", () => {
    const badPortfolio = [{ code: "000|1", name: "A|B基金", type: "equity", asset_class: "", role: "core" }];
    const md = generateResearchReportMarkdown({ portfolioFunds: badPortfolio, candidates: [], constraintDrafts: [] });
    expect(md).toContain("000\\|1");
    expect(md).toContain("A\\|B基金");
  });

  test("does not contain forbidden wording", () => {
    const candidates = [
      { fundCode: "000003", fundName: "C基金", fundType: "equity", performance: { return1y: "10", maxDrawdown: "-5", sharpeRatio: "1.2" }, feeManage: "0.015", totalScale: "20" },
    ];
    const drafts = generateConstraintDraft(candidates, portfolio);
    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates, constraintDrafts: drafts });
    const forbidden = ["买入", "卖出", "下单", "交易", "自动调仓", "信号进入组合"];
    forbidden.forEach((w) => {
      expect(md).not.toContain(w);
    });
  });

  test("formats fee, return, drawdown, sharpe, scale correctly", () => {
    const candidates = [
      { fundCode: "000003", fundName: "C基金", fundType: "equity", performance: { return1y: "15.5", maxDrawdown: "-8.2", sharpeRatio: "1.35" }, feeManage: "0.012", totalScale: "25.6" },
    ];
    const drafts = generateConstraintDraft(candidates, portfolio);
    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates, constraintDrafts: drafts });
    expect(md).toContain("15.50%");
    expect(md).toContain("-8.20%");
    expect(md).toContain("1.35");
    expect(md).toContain("1.20%");
    expect(md).toContain("25.60亿");
  });

  test("includes candidate match analysis section", () => {
    const candidates = [
      { fundCode: "000003", fundName: "C基金", fundType: "equity", performance: { return1y: "10", maxDrawdown: "-5", sharpeRatio: "1.2" }, feeManage: "0.015", totalScale: "20" },
    ];
    const drafts = generateConstraintDraft(candidates, portfolio);
    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates, constraintDrafts: drafts });
    expect(md).toContain("## 3. 候选池匹配分析");
    expect(md).toContain("同类1只");
  });

  test("includes backtest summary section header", () => {
    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [] });
    expect(md).toContain("## 5. 回测摘要");
  });

  test("shows empty backtest when no results", () => {
    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [] });
    expect(md).toContain("暂无策略回测结果");
    expect(md).toContain("暂无定投回测结果");
  });

  test("includes strategy backtest metrics when provided", () => {
    const backtestResult = {
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
      data_quality: {
        earliest_common_date: "2020-01-02",
        total_trading_days: 1200,
        assets_with_full_history: 5,
        assets_with_partial_history: 1,
        missing_assets: [],
        macro_coverage_pct: 95,
      },
      curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
    } as any;

    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [], backtestResult });
    expect(md).toContain("### 5.1 策略回测");
    expect(md).toContain("年化收益");
    expect(md).toContain("+7.20%");
    expect(md).toContain("年化波动");
    expect(md).toContain("+12.50%");
    expect(md).toContain("最大回撤");
    expect(md).toContain("-15.30%");
    expect(md).toContain("Sharpe");
    expect(md).toContain("1.35");
    expect(md).toContain("Sortino");
    expect(md).toContain("Calmar");
    expect(md).toContain("月度胜率");
    expect(md).toContain("58.3%");
  });

  test("includes DCA backtest metrics when provided", () => {
    const dcaResult = {
      totalInvested: 120000,
      finalValue: 145000,
      totalReturn: 20.83,
      annualizedReturn: 7.5,
      maxDrawdown: -12.0,
      sharpeRatio: 1.1,
      feeCost: 0.5,
      strategy: "fixed_amount",
      frequency: "monthly",
    } as any;

    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [], dcaResult });
    expect(md).toContain("### 5.2 定投回测");
    expect(md).toContain("总投入");
    expect(md).toContain("120,000.00");
    expect(md).toContain("期末市值");
    expect(md).toContain("145,000.00");
    expect(md).toContain("总收益");
    expect(md).toContain("+20.83%");
    expect(md).toContain("年化收益");
    expect(md).toContain("+7.50%");
    expect(md).toContain("最大回撤");
    expect(md).toContain("-12.00%");
  });

  test("sharpe and sortino display without percent", () => {
    const backtestResult = {
      metrics: {
        saa_taa: { annualized_return: 5, annualized_volatility: 10, max_drawdown: -8, sharpe_ratio: 1.0, sortino_ratio: 1.2, calmar_ratio: 0.5, monthly_win_rate: 50, max_drawdown_duration_days: 90, avg_turnover: 20, total_rebalances: 12, taa_value_added: null },
      },
      data_quality: { earliest_common_date: "2020-01-01", total_trading_days: 100, assets_with_full_history: 5, assets_with_partial_history: 0, missing_assets: [], macro_coverage_pct: 100 },
      curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
    } as any;

    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [], backtestResult });
    expect(md).toContain("| Sharpe | 1.00 |");
    expect(md).toContain("| Sortino | 1.20 |");
    expect(md).toContain("| Calmar | 0.50 |");
  });

  test("percentages are not multiplied by 100 again", () => {
    const backtestResult = {
      metrics: {
        saa_taa: { annualized_return: 7.2, annualized_volatility: 12.5, max_drawdown: -15.3, sharpe_ratio: 1.0, sortino_ratio: 1.2, calmar_ratio: 0.5, monthly_win_rate: 58.3, max_drawdown_duration_days: 90, avg_turnover: 20, total_rebalances: 12, taa_value_added: null },
      },
      data_quality: { earliest_common_date: "2020-01-01", total_trading_days: 100, assets_with_full_history: 5, assets_with_partial_history: 0, missing_assets: [], macro_coverage_pct: 100 },
      curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
    } as any;

    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [], backtestResult });
    expect(md).toContain("+7.20%");
    expect(md).not.toContain("720.00%");
    expect(md).not.toContain("+720.00%");
  });

  test("missing values show dash not zero", () => {
    const backtestResult = {
      metrics: {
        saa_taa: { annualized_return: null, annualized_volatility: null, max_drawdown: null, sharpe_ratio: null, sortino_ratio: null, calmar_ratio: null, monthly_win_rate: null, max_drawdown_duration_days: null, avg_turnover: null, total_rebalances: null, taa_value_added: null },
      },
      data_quality: null,
      curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
    } as any;

    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [], backtestResult });
    expect(md).toContain("| 年化收益 | — |");
    expect(md).toContain("| Sharpe | — |");
    expect(md).not.toContain("| 年化收益 | 0.00% |");
    expect(md).not.toContain("| Sharpe | 0.00 |");
  });

  test("report sections are in correct order", () => {
    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [] });
    const idx1 = md.indexOf("## 5. 回测摘要");
    const idx2 = md.indexOf("## 6. 数据缺口");
    const idx3 = md.indexOf("## 7. 说明");
    expect(idx1).toBeGreaterThan(0);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
  });

  test("backtest section does not contain forbidden wording", () => {
    const backtestResult = {
      metrics: {
        saa_taa: { annualized_return: 7, annualized_volatility: 10, max_drawdown: -8, sharpe_ratio: 1.0, sortino_ratio: 1.2, calmar_ratio: 0.5, monthly_win_rate: 50, max_drawdown_duration_days: 90, avg_turnover: 20, total_rebalances: 12, taa_value_added: null },
      },
      data_quality: { earliest_common_date: "2020-01-01", total_trading_days: 100, assets_with_full_history: 5, assets_with_partial_history: 0, missing_assets: [], macro_coverage_pct: 100 },
      curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
    } as any;
    const dcaResult = { totalInvested: 100000, finalValue: 110000, totalReturn: 10, annualizedReturn: 5, maxDrawdown: -5, sharpeRatio: 1.0, feeCost: 0.2, strategy: "fixed_amount", frequency: "monthly" } as any;

    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [], backtestResult, dcaResult });
    const forbidden = ["买入", "卖出", "下单", "交易", "自动调仓", "信号进入组合"];
    forbidden.forEach((w) => {
      expect(md).not.toContain(w);
    });
  });

  test("restored backtestResult produces correct strategy metrics", () => {
    const backtestResult = {
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
      data_quality: {
        earliest_common_date: "2020-01-02",
        total_trading_days: 1200,
        assets_with_full_history: 5,
        assets_with_partial_history: 1,
        missing_assets: [],
        macro_coverage_pct: 95,
      },
      curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
    } as any;

    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [], backtestResult });
    expect(md).toContain("+7.20%");
    expect(md).toContain("+12.50%");
    expect(md).toContain("-15.30%");
    expect(md).toContain("1.35");
    expect(md).toContain("1.62");
    expect(md).toContain("0.47");
    expect(md).toContain("58.3%");
    expect(md).not.toContain("720.00%");
  });

  test("old snapshot without backtestResult shows empty state", () => {
    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [], backtestResult: undefined });
    expect(md).toContain("暂无策略回测结果");
    expect(md).toContain("暂无定投回测结果");
  });

  test("old snapshot without backtestResult field at all does not crash", () => {
    const input: any = { portfolioFunds: portfolio, candidates: [], constraintDrafts: [] };
    const md = generateResearchReportMarkdown(input);
    expect(md).toContain("## 5. 回测摘要");
    expect(md).toContain("暂无策略回测结果");
  });

  test("saved snapshot structure includes backtestResult", () => {
    const responsePayload: any = {
      execution_plan: null,
      dca_plan: { config: null, result: null },
      variants: null,
      backtestResult: {
        metrics: { saa_taa: { annualized_return: 5.5, annualized_volatility: 10, max_drawdown: -8, sharpe_ratio: 1.0, sortino_ratio: 1.2, calmar_ratio: 0.5, monthly_win_rate: 50, max_drawdown_duration_days: 90, avg_turnover: 20, total_rebalances: 12, taa_value_added: null } },
        data_quality: { earliest_common_date: "2020-01-01", total_trading_days: 100, assets_with_full_history: 5, assets_with_partial_history: 0, missing_assets: [], macro_coverage_pct: 100 },
        curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
      },
    };
    expect(responsePayload.backtestResult).toBeDefined();
    expect(responsePayload.backtestResult.metrics.saa_taa.annualized_return).toBe(5.5);
    expect(responsePayload.dca_plan).toBeDefined();
    expect(responsePayload.variants).toBeDefined();
  });

  test("generates report from researchReportSnapshot", () => {
    const researchReportSnapshot = {
      candidates: [
        { fundCode: "000003", fundName: "C基金", fundType: "equity", performance: { return1y: "10", maxDrawdown: "-5", sharpeRatio: "1.2" }, feeManage: "0.015", totalScale: "20" },
      ],
      matches: [
        { candidate: { fundCode: "000003", fundName: "C基金", fundType: "equity", performance: { return1y: "10", maxDrawdown: "-5", sharpeRatio: "1.2" } }, match: { inPortfolio: false, peerFunds: [], inferredAsset: "equity", dataCompleteness: 0.75, advantages: ["Sharpe优秀"], suggestion: "可作为风格补充研究", dataStatus: "ok" as const } },
      ],
      constraintDrafts: [
        { fundCode: "000003", fundName: "C基金", assetClass: "equity", assetClassLabel: "权益类", action: "candidate_for_style_supplement" as const, priority: "high" as const, reason: "组合缺少权益配置", constraints: ["补充权益敞口"], dataStatus: "ok" as const },
      ],
      capturedAt: "2024-01-15T10:00:00Z",
    };

    const md = generateResearchReportMarkdown({
      portfolioFunds: portfolio,
      candidates: [],
      constraintDrafts: [],
      researchReportSnapshot,
    });
    expect(md).toContain("## 2. 研究候选池");
    expect(md).toContain("000003");
    expect(md).toContain("C基金");
    expect(md).toContain("## 3. 候选池匹配分析");
    expect(md).toContain("新资产类别");
    expect(md).toContain("## 4. 配置约束草案");
    expect(md).toContain("补充权益敞口");
    expect(md).toContain("组合缺少权益配置");
  });

  test("no researchReportSnapshot shows empty research sections", () => {
    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [] });
    expect(md).toContain("## 2. 研究候选池");
    expect(md).toContain("暂无研究候选");
    expect(md).toContain("## 4. 配置约束草案");
    expect(md).toContain("暂无配置约束草案");
  });

  test("researchReportSnapshot takes precedence over direct candidates", () => {
    const researchReportSnapshot = {
      candidates: [{ fundCode: "SNAP", fundName: "Snapshot基金" }],
      matches: [],
      constraintDrafts: [],
      capturedAt: "2024-01-01T00:00:00Z",
    };
    const md = generateResearchReportMarkdown({
      portfolioFunds: portfolio,
      candidates: [{ fundCode: "LIVE", fundName: "Live基金" }],
      constraintDrafts: [],
      researchReportSnapshot,
    });
    expect(md).toContain("SNAP");
    expect(md).toContain("Snapshot基金");
    expect(md).not.toContain("LIVE");
    expect(md).not.toContain("Live基金");
  });

  test("saved plan markdown with backtest and snapshot contains all sections", () => {
    const backtestResult = {
      metrics: { saa_taa: { annualized_return: 7.2, annualized_volatility: 12.5, max_drawdown: -15.3, sharpe_ratio: 1.35, sortino_ratio: 1.62, calmar_ratio: 0.47, monthly_win_rate: 58.3, max_drawdown_duration_days: 120, avg_turnover: 25, total_rebalances: 18, taa_value_added: 1.5 } },
      data_quality: { earliest_common_date: "2020-01-02", total_trading_days: 1200, assets_with_full_history: 5, assets_with_partial_history: 1, missing_assets: [], macro_coverage_pct: 95 },
      curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
    } as any;

    const researchReportSnapshot = {
      candidates: [{ fundCode: "000003", fundName: "C基金", fundType: "equity", performance: { return1y: "10" }, feeManage: "0.015", totalScale: "20" }],
      matches: [{ candidate: { fundCode: "000003", fundName: "C基金", fundType: "equity", performance: {} }, match: { inPortfolio: false, peerFunds: [], inferredAsset: "equity", dataCompleteness: 0.5, advantages: [], suggestion: "可作为风格补充研究", dataStatus: "ok" } }],
      constraintDrafts: [{ fundCode: "000003", fundName: "C基金", assetClass: "equity" as any, assetClassLabel: "权益类", action: "candidate_for_style_supplement" as any, priority: "high" as any, reason: "组合缺少权益配置", constraints: ["补充权益敞口"], dataStatus: "ok" }],
      capturedAt: "2024-01-15T10:00:00Z",
    };

    const md = generateResearchReportMarkdown({
      portfolioFunds: portfolio,
      candidates: [],
      constraintDrafts: [],
      backtestResult,
      researchReportSnapshot,
      generatedAt: "2024-06-01",
    });

    expect(md).toContain("# 配置研究报告");
    expect(md).toContain("## 1. 当前组合基金");
    expect(md).toContain("## 2. 研究候选池");
    expect(md).toContain("## 3. 候选池匹配分析");
    expect(md).toContain("## 4. 配置约束草案");
    expect(md).toContain("## 5. 回测摘要");
    expect(md).toContain("## 6. 数据缺口");
    expect(md).toContain("## 7. 说明");
    expect(md).toContain("+7.20%");
    expect(md).toContain("补充权益敞口");
  });

  test("includes extended backtest metrics when provided", () => {
    const backtestResult = {
      metrics: {
        saa_taa: {
          annualized_return: 7.2,
          annualized_volatility: 12.5,
          max_drawdown: -15.3,
          sharpe_ratio: 1.35,
          sortino_ratio: 1.62,
          calmar_ratio: 0.47,
          information_ratio: 0.85,
          alpha: 1.23,
          beta: 0.92,
          tracking_error: 3.45,
          monthly_win_rate: 58.3,
          max_drawdown_duration_days: 120,
          avg_turnover: 25,
          total_rebalances: 18,
          taa_value_added: 1.5,
        },
      },
      data_quality: { earliest_common_date: "2020-01-02", total_trading_days: 1200, assets_with_full_history: 5, assets_with_partial_history: 0, missing_assets: [], macro_coverage_pct: 95 },
      curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
    } as any;

    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [], backtestResult });
    expect(md).toContain("信息比率");
    expect(md).toContain("Alpha");
    expect(md).toContain("Beta");
    expect(md).toContain("跟踪误差");
    expect(md).toContain("平均换手");
    expect(md).toContain("TAA贡献");
  });

  test("alpha displays as percentage without multiplying by 100", () => {
    const backtestResult = {
      metrics: {
        saa_taa: {
          annualized_return: 7.2,
          annualized_volatility: 12.5,
          max_drawdown: -15.3,
          sharpe_ratio: 1.35,
          sortino_ratio: 1.62,
          calmar_ratio: 0.47,
          information_ratio: 0.85,
          alpha: 1.23,
          beta: 0.92,
          tracking_error: 3.45,
          monthly_win_rate: 58.3,
          max_drawdown_duration_days: 120,
          avg_turnover: 25,
          total_rebalances: 18,
          taa_value_added: null,
        },
      },
      data_quality: { earliest_common_date: "2020-01-02", total_trading_days: 1200, assets_with_full_history: 5, assets_with_partial_history: 0, missing_assets: [], macro_coverage_pct: 95 },
      curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
    } as any;

    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [], backtestResult });
    expect(md).toContain("+1.23%");
    expect(md).not.toContain("+123.00%");
  });

  test("beta and sortino display without percent sign", () => {
    const backtestResult = {
      metrics: {
        saa_taa: {
          annualized_return: 7.2,
          annualized_volatility: 12.5,
          max_drawdown: -15.3,
          sharpe_ratio: 1.35,
          sortino_ratio: 1.62,
          calmar_ratio: 0.47,
          information_ratio: 0.85,
          alpha: 1.23,
          beta: 0.92,
          tracking_error: 3.45,
          monthly_win_rate: 58.3,
          max_drawdown_duration_days: 120,
          avg_turnover: 25,
          total_rebalances: 18,
          taa_value_added: null,
        },
      },
      data_quality: { earliest_common_date: "2020-01-02", total_trading_days: 1200, assets_with_full_history: 5, assets_with_partial_history: 0, missing_assets: [], macro_coverage_pct: 95 },
      curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
    } as any;

    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [], backtestResult });
    expect(md).toContain("| Beta | 0.92 |");
    expect(md).toContain("| Sortino | 1.62 |");
    expect(md).toContain("| Calmar | 0.47 |");
    expect(md).toContain("| 信息比率 | 0.85 |");
  });

  test("missing benchmark-dependent metrics show dash", () => {
    const backtestResult = {
      metrics: {
        saa_taa: {
          annualized_return: 7.2,
          annualized_volatility: 12.5,
          max_drawdown: -15.3,
          sharpe_ratio: 1.35,
          sortino_ratio: 1.62,
          calmar_ratio: 0.47,
          information_ratio: null,
          alpha: null,
          beta: null,
          tracking_error: null,
          monthly_win_rate: 58.3,
          max_drawdown_duration_days: 120,
          avg_turnover: 25,
          total_rebalances: 18,
          taa_value_added: null,
        },
      },
      data_quality: { earliest_common_date: "2020-01-02", total_trading_days: 1200, assets_with_full_history: 5, assets_with_partial_history: 0, missing_assets: [], macro_coverage_pct: 95 },
      curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
    } as any;

    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [], backtestResult });
    expect(md).toContain("| 信息比率 | — |");
    expect(md).toContain("| Alpha | — |");
    expect(md).toContain("| Beta | — |");
    expect(md).toContain("| 跟踪误差 | — |");
    expect(md).toContain("| TAA贡献 | — |");
  });

  test("monthly_win_rate is not multiplied by 100", () => {
    const backtestResult = {
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
          taa_value_added: null,
        },
      },
      data_quality: { earliest_common_date: "2020-01-02", total_trading_days: 1200, assets_with_full_history: 5, assets_with_partial_history: 0, missing_assets: [], macro_coverage_pct: 95 },
      curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
    } as any;

    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [], backtestResult });
    expect(md).toContain("58.3%");
    expect(md).not.toContain("5830.0%");
  });

  test("report does not contain forbidden wording", () => {
    const backtestResult = {
      metrics: {
        saa_taa: {
          annualized_return: 7.2,
          annualized_volatility: 12.5,
          max_drawdown: -15.3,
          sharpe_ratio: 1.35,
          sortino_ratio: 1.62,
          calmar_ratio: 0.47,
          information_ratio: 0.85,
          alpha: 1.23,
          beta: 0.92,
          tracking_error: 3.45,
          monthly_win_rate: 58.3,
          max_drawdown_duration_days: 120,
          avg_turnover: 25,
          total_rebalances: 18,
          taa_value_added: 1.5,
        },
      },
      data_quality: { earliest_common_date: "2020-01-02", total_trading_days: 1200, assets_with_full_history: 5, assets_with_partial_history: 0, missing_assets: [], macro_coverage_pct: 95 },
      curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
    } as any;

    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [], backtestResult });
    const forbidden = ["买入", "卖出", "下单", "交易", "自动调仓", "信号进入组合"];
    forbidden.forEach((w) => {
      expect(md).not.toContain(w);
    });
  });

  test("includes cost assumption section when provided", () => {
    const backtestResult = {
      metrics: {
        saa_taa: {
          annualized_return: 7.2, annualized_volatility: 12.5, max_drawdown: -15.3,
          sharpe_ratio: 1.35, sortino_ratio: 1.62, calmar_ratio: 0.47,
          information_ratio: 0.85, alpha: 1.23, beta: 0.92, tracking_error: 3.45,
          monthly_win_rate: 58.3, max_drawdown_duration_days: 120,
          avg_turnover: 25, total_rebalances: 18, taa_value_added: 1.5,
        },
      },
      cost_assumption: {
        enabled: true,
        cost_bps: 20,
        total_cost_pct: 2.5,
        annualized_cost_pct: 0.85,
        avg_turnover_pct: 25,
        rebalance_count: 18,
        source: "default_assumption",
      },
      data_quality: { earliest_common_date: "2020-01-02", total_trading_days: 1200, assets_with_full_history: 5, assets_with_partial_history: 0, missing_assets: [], macro_coverage_pct: 95 },
      curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
    } as any;

    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [], backtestResult });
    expect(md).toContain("成本假设与换手影响");
    expect(md).toContain("20 bps");
    expect(md).toContain("2.50%");
    expect(md).toContain("0.85%");
    expect(md).toContain("25.0%");
    expect(md).toContain("18");
    expect(md).toContain("default_assumption");
  });

  test("shows no cost data when cost_assumption is missing", () => {
    const backtestResult = {
      metrics: {
        saa_taa: {
          annualized_return: 7.2, annualized_volatility: 12.5, max_drawdown: -15.3,
          sharpe_ratio: 1.35, sortino_ratio: 1.62, calmar_ratio: 0.47,
          monthly_win_rate: 58.3, max_drawdown_duration_days: 120,
          avg_turnover: 25, total_rebalances: 18, taa_value_added: 1.5,
        },
      },
      data_quality: { earliest_common_date: "2020-01-02", total_trading_days: 1200, assets_with_full_history: 5, assets_with_partial_history: 0, missing_assets: [], macro_coverage_pct: 95 },
      curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
    } as any;

    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [], backtestResult });
    expect(md).toContain("成本假设与换手影响");
    expect(md).toContain("暂无成本扣减数据");
  });

  test("cost assumption total_cost_pct not multiplied by 100", () => {
    const backtestResult = {
      metrics: {
        saa_taa: {
          annualized_return: 7.2, annualized_volatility: 12.5, max_drawdown: -15.3,
          sharpe_ratio: 1.35, sortino_ratio: 1.62, calmar_ratio: 0.47,
          monthly_win_rate: 58.3, max_drawdown_duration_days: 120,
          avg_turnover: 25, total_rebalances: 18, taa_value_added: null,
        },
      },
      cost_assumption: {
        enabled: true,
        cost_bps: 20,
        total_cost_pct: 1.23,
        annualized_cost_pct: 0.45,
        avg_turnover_pct: 25,
        rebalance_count: 18,
        source: "default_assumption",
      },
      data_quality: { earliest_common_date: "2020-01-02", total_trading_days: 1200, assets_with_full_history: 5, assets_with_partial_history: 0, missing_assets: [], macro_coverage_pct: 95 },
      curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
    } as any;

    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [], backtestResult });
    expect(md).toContain("1.23%");
    expect(md).not.toContain("123.00%");
    expect(md).toContain("0.45%");
    expect(md).not.toContain("45.00%");
  });

  test("cost assumption section does not contain forbidden wording", () => {
    const backtestResult = {
      metrics: {
        saa_taa: {
          annualized_return: 7.2, annualized_volatility: 12.5, max_drawdown: -15.3,
          sharpe_ratio: 1.35, sortino_ratio: 1.62, calmar_ratio: 0.47,
          monthly_win_rate: 58.3, max_drawdown_duration_days: 120,
          avg_turnover: 25, total_rebalances: 18, taa_value_added: null,
        },
      },
      cost_assumption: {
        enabled: true,
        cost_bps: 20,
        total_cost_pct: 2.5,
        annualized_cost_pct: 0.85,
        avg_turnover_pct: 25,
        rebalance_count: 18,
        source: "default_assumption",
      },
      data_quality: { earliest_common_date: "2020-01-02", total_trading_days: 1200, assets_with_full_history: 5, assets_with_partial_history: 0, missing_assets: [], macro_coverage_pct: 95 },
      curves: {}, regime_history: [], rebalance_events: [], attribution: {}, rolling_sharpe: {}, monthly_returns: {},
    } as any;

    const md = generateResearchReportMarkdown({ portfolioFunds: portfolio, candidates: [], constraintDrafts: [], backtestResult });
    const forbidden = ["买入", "卖出", "下单", "交易", "自动调仓", "信号进入组合"];
    forbidden.forEach((w) => {
      expect(md).not.toContain(w);
    });
  });
});
