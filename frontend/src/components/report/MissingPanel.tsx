import type { ReactNode } from "react";

/**
 * 缺数占位面板。
 *
 * 规范（与 iFinD 重排方案锁定）：
 *  - 标题旁始终挂一个虚线徽标 "🛈 数据待补"，方便全文 grep 统计补全进度。
 *  - 主体三行：图标 / 主文案 / 副文案（解释依赖哪个 endpoint）。
 *  - 占位仍占据 Grid 位置，不折叠；避免布局抖动。
 *  - 严禁假数据；缺数就是缺数。
 */
type MissingPanelProps = {
  title: string;
  reason: string;
  endpoint?: string;
  height?: number;
  children?: ReactNode;
};

export function MissingPanel({
  title,
  reason,
  endpoint,
  height = 260,
  children,
}: MissingPanelProps) {
  return (
    <section className="rounded-lg border bg-card text-card-foreground">
      <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
        <span>{title}</span>
        <span
          className="rounded border border-dashed border-muted-foreground/40 px-2 py-0.5 text-[11px] font-normal text-muted-foreground"
          title="该面板依赖后端接口，待补全后展示真实数据"
        >
          🛈 数据待补
        </span>
      </div>
      <div className="p-4">
        <div
          className="flex flex-col items-center justify-center gap-2 text-center"
          style={{ minHeight: height }}
        >
          <span aria-hidden className="text-2xl text-muted-foreground/40">
            🗄
          </span>
          <div className="text-sm text-muted-foreground">暂无 {title} 数据</div>
          <div className="max-w-md text-xs text-muted-foreground/70">{reason}</div>
          {endpoint ? (
            <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {endpoint}
            </code>
          ) : null}
        </div>
        {children}
      </div>
    </section>
  );
}
