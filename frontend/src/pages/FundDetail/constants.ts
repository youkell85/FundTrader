export const RANGE_OPTIONS = ["1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "MAX"] as const;
export type RangeKey = (typeof RANGE_OPTIONS)[number];
export const DETAIL_STATIC_STALE_MS = 24 * 60 * 60 * 1000;
export const DETAIL_QUARTERLY_STALE_MS = 6 * 60 * 60 * 1000;
export const DETAIL_LLM_STALE_MS = 30 * 60 * 1000;

// 4 系列颜色：与 PDF 一致
export const SERIES_COLORS = {
  fund: "#3B6CFF",
  peer: "#46C6C2",
  index: "#E9AB60",
  bench: "#5CA8DF",
};

// 多分类饼图/柱图色板
export const chartColors = ["#3B6CFF", "#46C6C2", "#E9AB60", "#5CA8DF", "#9D7BFF", "#FFB800"];

// 统一 Tooltip 样式：半透明背景+紧凑
export const TOOLTIP_STYLE = {
  backgroundColor: "rgba(0,2,18,0.92)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 6,
  fontSize: 12,
  padding: "6px 10px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
  color: "rgba(255,255,255,0.85)",
};

export const ANCHOR_ITEMS = [
  { id: "perf", label: "业绩与回撤" },
  { id: "peer", label: "同类与基准" },
  { id: "market-context", label: "市场上下文" },
  { id: "risk", label: "风险画像" },
  { id: "alloc", label: "持仓与配置" },
  { id: "scale", label: "规模 · 换手 · 持有人" },
  { id: "manager", label: "经理与运作" },
  { id: "meta", label: "购买与评级" },
  { id: "gaps", label: "数据缺口" },
];

// === 工具：日期范围过滤 ===
