import type { ReactNode } from "react";

/**
 * 锚点 section。每个 section 自带 id，可被顶部 AnchorNav 跳转。
 */
type ReportSectionProps = {
  id: string;
  title?: string;
  badge?: string;
  children: ReactNode;
};

export function ReportSection({ id, title, badge, children }: ReportSectionProps) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      {title ? (
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {badge ? (
            <span className="rounded border border-dashed border-white/15 px-2 py-0.5 text-[11px] font-normal text-white/50">
              {badge}
            </span>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
