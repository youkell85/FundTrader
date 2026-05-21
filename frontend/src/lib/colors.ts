/**
 * FundTrader 统一金融配色方案
 * 严格遵循中国大陆标准：涨红跌绿（红涨绿跌）
 * 提供专业、易读、中性的金融视觉语言
 */

// === 涨跌颜色（严格涨红跌绿） ===
export const UP_COLOR = "#F5384B"; // 上涨（专业红）
export const UP_COLOR_BG = "rgba(245,56,75,0.12)";
export const UP_COLOR_BORDER = "rgba(245,56,75,0.35)";

export const DOWN_COLOR = "#16C784"; // 下跌（专业绿）
export const DOWN_COLOR_BG = "rgba(22,199,132,0.12)";
export const DOWN_COLOR_BORDER = "rgba(22,199,132,0.35)";

export const NEUTRAL_COLOR = "rgba(255,255,255,0.6)"; // 平盘

// === 中性视觉色（用于非涨跌信息）===
export const ACCENT_PRIMARY = "#3B6CFF"; // 品牌主色（按钮/链接/图表线条）
export const ACCENT_INFO = "#5AA9FF"; // 信息蓝（夏普、信息比率等中性指标）
export const ACCENT_HIGHLIGHT = "#FFB800"; // 评级金色（仅星级使用）
export const ACCENT_PURPLE = "#9D7BFF"; // 辅助紫（仅图例区分使用）

// === 收益率/涨跌幅 → 颜色 ===
export function getChangeColor(value: number | string | null | undefined): string {
  const v = typeof value === "number" ? value : parseFloat(String(value ?? "0"));
  if (!Number.isFinite(v) || v === 0) return NEUTRAL_COLOR;
  return v > 0 ? UP_COLOR : DOWN_COLOR;
}

export function getChangeBgColor(value: number | string | null | undefined): string {
  const v = typeof value === "number" ? value : parseFloat(String(value ?? "0"));
  if (!Number.isFinite(v) || v === 0) return "transparent";
  return v > 0 ? UP_COLOR_BG : DOWN_COLOR_BG;
}

// === Tailwind class helper（行内 className 中使用）===
export function getChangeTextClass(value: number | string | null | undefined): string {
  const v = typeof value === "number" ? value : parseFloat(String(value ?? "0"));
  if (!Number.isFinite(v) || v === 0) return "text-white/60";
  return v > 0 ? "text-[#F5384B]" : "text-[#16C784]";
}

// === 风险/回撤指标专用色（始终为绿色或暖色）===
export const RISK_COLOR = "#FFB800"; // 警示橙金（用于波动率、回撤标识）
export const POSITIVE_METRIC_COLOR = ACCENT_INFO; // 夏普/卡玛/Alpha 等中性正向指标（不算涨跌）
