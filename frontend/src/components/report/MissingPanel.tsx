export type MissingPanelProps = {
  title: string;
  reason: string;
  endpoint?: string;
  height?: number;
  children?: React.ReactNode;
};

/**
 * 暗色 liquid-glass 风格缺失态面板。
 *
 * - 不显示假数据 / 不显示占位图表
 * - 必须显式声明：title / reason / endpoint
 * - 配色与 FundTable 的降级态保持一致
 */
export function MissingPanel({
  title,
  reason,
  endpoint,
  height = 260,
  children,
}: MissingPanelProps) {
  return (
    <section
      className="rounded-lg border border-white/[0.06] bg-white/[0.02] text-white/60"
      style={{ minHeight: height }}
    >
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5 text-sm font-medium text-white/70">
        <span className="truncate">{title}</span>
        <span
          className="shrink-0 rounded border border-dashed border-white/15 px-2 py-0.5 text-[11px] font-normal text-white/50"
          title="该面板依赖后端接口，待补全后展示真实数据"
        >
          🛈 数据待补
        </span>
      </div>
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-6 text-center">
        <span aria-hidden className="text-2xl text-white/30">🗄</span>
        <div className="text-sm text-white/55">暂无数据</div>
        <div className="max-w-md text-xs text-white/40">{reason}</div>
        {endpoint ? (
          <code className="rounded border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 text-[10px] text-white/45">
            {endpoint}
          </code>
        ) : null}
        {children}
      </div>
    </section>
  );
}
