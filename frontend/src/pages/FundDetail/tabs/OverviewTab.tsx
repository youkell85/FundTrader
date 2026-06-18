import { CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";
import { SourceCoveragePanel } from "@/components/fund-detail/DetailStatusPanels";
import { Panel } from "@/components/report/Panel";
import { num, numFmt, pct } from "@/lib/fund-data";
import { DataGapsPanel } from "../components/DataGapsPanel";
import { FieldSourceTip } from "../components/FieldSourceTip";
import type { FundDetailTabProps, FundDetailTabKey } from "./types";

function riskLabel(detail: FundDetailTabProps["detail"]) {
  const maxDrawdown = detail.risk.maxDrawdown;
  const volatility = detail.risk.volatility;
  if (maxDrawdown === null || volatility === null) {
    return { label: "待确认", tone: "text-white/55", icon: CircleDashed };
  }
  if (maxDrawdown < -30 || volatility > 25) {
    return { label: "高风险", tone: "text-[#F5384B]", icon: CircleAlert };
  }
  if (maxDrawdown < -15 || volatility > 18) {
    return { label: "中等风险", tone: "text-[#FFB800]", icon: CircleAlert };
  }
  return { label: "风险可控", tone: "text-[#16C784]", icon: CheckCircle2 };
}

function nextAction(detail: FundDetailTabProps["detail"]): FundDetailTabKey {
  const gaps = detail.coverage.missing + detail.coverage.error + detail.coverage.partial + detail.coverage.stale;
  if (gaps > 0) return "diagnosis";
  if (num((detail.fund as any)?.performance?.return1y) === null) return "performance";
  return "market";
}

export default function OverviewTab({ detail, onSelectTab }: FundDetailTabProps) {
  const perf = (detail.fund as any)?.performance || {};
  const return1y = num(perf.return1y);
  const gaps = detail.coverage.missing + detail.coverage.error + detail.coverage.partial + detail.coverage.stale;
  const risk = riskLabel(detail);
  const RiskIcon = risk.icon;
  const actionTab = nextAction(detail);

  const conclusion =
    gaps > 0
      ? "先补齐或确认关键数据，再阅读收益和风险结论。"
      : return1y === null
        ? "收益数据不足，先查看业绩与回撤。"
        : return1y >= 0
          ? "近一年收益为正，继续核对回撤、同类比较和市场环境。"
          : "近一年收益为负，优先核对回撤、持仓暴露和数据来源。";

  return (
    <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-3">
        <Panel title="一句话结论">
          <div className="text-sm leading-relaxed text-white/80">{conclusion}</div>
        </Panel>

        <Panel title="核心指标">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Metric label="近一年收益" value={pct(return1y)} tone={return1y !== null ? (return1y >= 0 ? "text-[#16C784]" : "text-[#F5384B]") : ""} />
            <Metric label="最大回撤" value={pct(detail.risk.maxDrawdown)} />
            <Metric label="夏普" value={numFmt(detail.risk.sharpe, 2)} />
          </div>
        </Panel>

        <Panel title="下一步动作">
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={() => onSelectTab(actionTab)}>
              {actionTab === "diagnosis" ? "查看数据缺口" : actionTab === "performance" ? "查看业绩" : "查看市场环境"}
            </ActionButton>
            <ActionButton onClick={() => onSelectTab("performance")}>业绩与回撤</ActionButton>
            <ActionButton onClick={() => onSelectTab("holdings")}>持仓与配置</ActionButton>
          </div>
        </Panel>
      </div>

      <div className="space-y-3">
        <Panel title="风险等级">
          <div className={`flex items-center gap-2 text-base font-semibold ${risk.tone}`}>
            <RiskIcon className="h-5 w-5" />
            {risk.label}
          </div>
          <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
            基于当前净值窗口计算回撤、波动和夏普。数据不足时不输出强判断。
          </div>
        </Panel>

        <Panel title="数据完整度">
          <div className="mb-2 flex items-center gap-2 text-sm text-white/75">
            <span className="data-number font-semibold">
              {detail.coverage.total ? `${detail.coverage.available}/${detail.coverage.total}` : "-"}
            </span>
            <span>可用</span>
            <FieldSourceTip source="detail coverage summary" status={detail.coverage.missing + detail.coverage.error > 0 ? "missing" : "available"} />
          </div>
          <DataGapsPanel items={detail.coverage.items} />
        </Panel>

        <SourceCoveragePanel summary={detail.sourceCoverage} />
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div className="text-xs text-white/45">{label}</div>
      <div className={`mt-1 data-number text-lg font-semibold ${tone || "text-white/85"}`}>{value}</div>
    </div>
  );
}

function ActionButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/75 hover:bg-white/[0.06]"
    >
      {children}
    </button>
  );
}
