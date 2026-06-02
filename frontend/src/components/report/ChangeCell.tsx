import type { ReactNode } from "react";
import { getChangeTextClass } from "@/lib/colors";

/**
 * 涨跌单元格：
 *  - sign="updown"：用于"涨跌幅"，正值红、负值绿（红涨绿跌）。
 *  - sign="versus"：用于"±同类"行，含义反过来：正值绿（优于同类）、负值红（劣于同类）。
 *  - sign="plain"：直接染色。
 */
type ChangeCellProps = {
  value: string | number | null | undefined;
  digits?: number;
  suffix?: string;
  className?: string;
  sign?: "updown" | "versus" | "plain";
  fallback?: string;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "—" || v === "--") return null;
  const x = parseFloat(String(v).replace("%", ""));
  return Number.isFinite(x) ? x : null;
}

function fmt(v: unknown, digits = 2, suffix = "%"): string {
  const x = num(v);
  return x === null ? "—" : `${x.toFixed(digits)}${suffix}`;
}

export function ChangeCell({
  value,
  digits = 2,
  suffix = "%",
  className = "",
  sign = "updown",
  fallback = "—",
}: ChangeCellProps) {
  const x = num(value);
  if (x === null) {
    return (
      <span className={`text-muted-foreground ${className}`} data-testid="change-cell">
        {fallback}
      </span>
    );
  }
  const tone =
    sign === "updown"
      ? getChangeTextClass(x)
      : sign === "versus"
        ? // ±同类：相反语义
          x > 0
          ? "text-[#16C784]"
          : x < 0
            ? "text-[#F5384B]"
            : "text-white/60"
        : "";
  const prefix = x > 0 ? "+" : "";
  return (
    <span
      className={`data-number ${tone} ${className}`}
      data-testid="change-cell"
      data-sign={sign}
    >
      {prefix}
      {fmt(Math.abs(x), digits, suffix)}
    </span>
  );
}

export function ChangeCellInline({
  value,
  children,
  sign = "updown",
}: {
  value: string | number | null | undefined;
  children: ReactNode;
  sign?: "updown" | "versus" | "plain";
}) {
  const x = num(value);
  if (x === null) return <span className="text-muted-foreground">{children}</span>;
  const tone =
    sign === "updown"
      ? getChangeTextClass(x)
      : sign === "versus"
        ? x > 0
          ? "text-[#16C784]"
          : x < 0
            ? "text-[#F5384B]"
            : "text-white/60"
        : "";
  return <span className={`data-number ${tone}`}>{children}</span>;
}
