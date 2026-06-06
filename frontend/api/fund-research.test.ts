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
