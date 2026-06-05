import type { ReactNode } from "react";

/**
 * 通用面板容器：暗色 liquid-glass 风格，与 FundTable 头部一致。
 * 限定用于基金详情页（FundDetail.tsx）。
 */
type PanelProps = {
  title: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Panel({ title, extra, children, className = "" }: PanelProps) {
  return (
    <section
      className={`rounded-lg border border-white/[0.06] bg-white/[0.02] text-white/80 ${className}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2.5 text-sm font-medium text-white/80">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate">{title}</span>
        </div>
        {extra ? <div className="flex shrink-0 items-center gap-2">{extra}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-6 w-full animate-pulse rounded bg-secondary/60" />
      ))}
    </div>
  );
}
