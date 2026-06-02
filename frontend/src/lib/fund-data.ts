/**
 * fund-data adapter。
 *
 * 单一职责：把 trpc 返回的原始数据规整成"已具名 + 已判断缺数"的结构。
 * 组件层只消费这里导出的 getter；若 getter 返回 null，组件用 <MissingPanel>。
 *
 * 这样未来后端补齐接口时，只需改本文件，组件不动。
 */
import type { getChangeTextClass as _ignored } from "@/lib/colors";

export type NumValue = number | null;

export function num(v: unknown): NumValue {
  if (v === null || v === undefined || v === "" || v === "—" || v === "--") return null;
  const x = parseFloat(String(v).replace("%", ""));
  return Number.isFinite(x) ? x : null;
}

export function pct(v: unknown, digits = 2): string {
  const x = num(v);
  return x === null ? "—" : `${x.toFixed(digits)}%`;
}

export function numFmt(v: unknown, digits = 2): string {
  const x = num(v);
  return x === null ? "—" : x.toFixed(digits);
}

export function isMissing(v: unknown): boolean {
  return v === null || v === undefined || v === "" || v === "—" || v === "--";
}

/** 把 0~1 比例或 0~100 比例统一转成 0~100 数值。 */
export function ratioPct(v: unknown): number {
  const x = num(v) ?? 0;
  return x > 1 ? x : x * 100;
}

// === 已实现端点：业绩曲线需要的 4 条系列 ===
//   - 本基金：navPoints（已有）
//   - 偏股混合均值：暂无
//   - 沪深300：暂无
//   - 业绩比较基准：暂无
//
// 后续后端补齐时，新增 useQuery 在此导出对应 series，
// 组件切换即可，无需改 chart 代码。

export type PeerSeries = {
  /** 名称（出现在图例） */
  name: string;
  /** 与基金同期的累计收益%，按 d 升序 */
  data: Array<{ d: string; value: number }>;
  /** 该系列在当前 range 下的累计收益，渲染到图例 */
  rangeReturn: number | null;
  /** recharts 颜色 */
  color: string;
};

export function emptyPeerSeries(name: string, color: string, rangeReturn: number | null = null): PeerSeries {
  return { name, data: [], rangeReturn, color };
}

// === 业绩对比表 4 行 × 7 列 ===
// 现状：trpc.fund.peerPerformanceRanking 只返回 4 行（1m/3m/6m/1y），
//      7 列（近3月/近6月/近1年/近3年/近5年/成立至今/年化回报）由 fund.performance 与
//      额外同类均值接口（待补）共同提供。
//
// 现状下我们能做：
//  - 1m/3m/6m/1y 列：取 peerPerformanceRanking
//  - 3y/5y/成立以来/年化：取 fund.performance
//
// 缺的：
//  - 偏股混合均值的 3y/5y/成立以来/年化
//  - 沪深300 的 3y/5y/成立以来/年化
//  - 业绩比较基准 的 3y/5y/成立以来/年化
//  - 同类排名 rank/total（除 4 个 peer 已有外）
//
// 缺数列统一在表里渲染为 "—"，并配 ±同类列（如果后端补了的话）。

export type PerfCell = { value: number | null; rank?: { rank: number; total: number } | null };
export type PerfRow = { key: string; label: string; cells: Record<string, PerfCell> };

// 列顺序固定，与 PDF 7 列对应
export const PERF_COLS = [
  { key: "3m", label: "近3月" },
  { key: "6m", label: "近6月" },
  { key: "1y", label: "近1年" },
  { key: "3y", label: "近3年" },
  { key: "5y", label: "近5年" },
  { key: "since", label: "成立至今" },
  { key: "annual", label: "年化回报" },
] as const;

export type PerfCol = (typeof PERF_COLS)[number]["key"];

export function emptyPerfCell(value: number | null = null): PerfCell {
  return { value, rank: null };
}
