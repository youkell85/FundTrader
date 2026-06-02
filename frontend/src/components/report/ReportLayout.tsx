import type { ReactNode } from "react";

/**
 * 长页面布局：
 *  - 宽屏（≥ xl / 1280px）：左 360 + 右自适应网格（侧栏基本信息在左，主区业绩/风险/持仓在右）。
 *  - 窄屏（< xl）：单列流，侧栏（基本信息/评级/投资目标）在上，主区（业绩/风险/持仓）在下。
 */
type ReportLayoutProps = {
  /** 侧栏：评级、基本信息、投资目标、比较基准、购买信息、同类、数据覆盖等。 */
  left: ReactNode;
  /** 主区：业绩表现、历史回报、规模/换手、风险分析、资产/行业、重仓明细、经理、运作分析。 */
  right: ReactNode;
};

export function ReportLayout({ left, right }: ReportLayoutProps) {
  return (
    <div className="mt-3 flex flex-col gap-3 xl:grid xl:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="order-1 min-w-0 space-y-3">{left}</aside>
      <main className="order-2 min-w-0 space-y-6">{right}</main>
    </div>
  );
}
