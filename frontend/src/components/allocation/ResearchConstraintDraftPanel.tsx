/**
 * ResearchConstraintDraftPanel
 *
 * 配置约束草案面板：基于研究候选池 + 当前组合基金，生成只读约束草案。
 *
 * 约束：
 * - 不自动改权重
 * - 不调用后端分配接口
 * - 不持久化
 * - 不进入交易系统
 */

import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  FileText,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Info,
  Shield,
  Eye,
  Layers,
  Search,
  XCircle,
} from "lucide-react";
import {
  generateConstraintDraft,
  type ConstraintDraftItem,
  type ConstraintAction,
} from "@/lib/fund-research";

interface Props {
  candidates: any[];
  portfolioFunds: any[];
  loading?: boolean;
}

const ACTION_LABELS: Record<ConstraintAction, string> = {
  already_in_portfolio: "已在组合中",
  candidate_for_peer_comparison: "同类替代观察",
  candidate_for_style_supplement: "风格补充候选",
  data_required: "数据待补齐",
  watch_only: "持续观察",
};

const ACTION_COLORS: Record<ConstraintAction, string> = {
  already_in_portfolio: "text-[#16C784]",
  candidate_for_peer_comparison: "text-[#5AA9FF]",
  candidate_for_style_supplement: "text-[#9D7BFF]",
  data_required: "text-[#EE6666]",
  watch_only: "text-white/50",
};

const ACTION_BG: Record<ConstraintAction, string> = {
  already_in_portfolio: "bg-[#16C784]/[0.06] border-[#16C784]/20",
  candidate_for_peer_comparison: "bg-[#5AA9FF]/[0.06] border-[#5AA9FF]/20",
  candidate_for_style_supplement: "bg-[#9D7BFF]/[0.06] border-[#9D7BFF]/20",
  data_required: "bg-[#EE6666]/[0.06] border-[#EE6666]/20",
  watch_only: "bg-white/[0.02] border-white/[0.06]",
};

const PRIORITY_LABELS = { high: "高", medium: "中", low: "低" } as const;
const PRIORITY_COLORS = { high: "text-[#EE6666]", medium: "text-[#FAC858]", low: "text-white/40" } as const;

function DataStatusBadge({ status }: { status: ConstraintDraftItem["dataStatus"] }) {
  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-[#16C784]">
        <CheckCircle2 className="w-3 h-3" /> 完整
      </span>
    );
  }
  if (status === "partial") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-[#FAC858]">
        <AlertTriangle className="w-3 h-3" /> 部分缺失
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-[#EE6666]">
      <XCircle className="w-3 h-3" /> 缺失
    </span>
  );
}

function ActionIcon({ action }: { action: ConstraintAction }) {
  switch (action) {
    case "already_in_portfolio":
      return <Shield className="w-3.5 h-3.5" />;
    case "candidate_for_peer_comparison":
      return <Search className="w-3.5 h-3.5" />;
    case "candidate_for_style_supplement":
      return <Layers className="w-3.5 h-3.5" />;
    case "data_required":
      return <AlertTriangle className="w-3.5 h-3.5" />;
    case "watch_only":
      return <Eye className="w-3.5 h-3.5" />;
  }
}

export default function ResearchConstraintDraftPanel({ candidates, portfolioFunds, loading }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const drafts = useMemo(
    () => generateConstraintDraft(candidates, portfolioFunds),
    [candidates, portfolioFunds]
  );

  const handleCopy = async () => {
    setCopyError(false);
    try {
      const text = drafts
        .map(
          (d) =>
            `[${d.fundCode}] ${d.fundName}\n` +
            `  资产大类: ${d.assetClassLabel}\n` +
            `  建议类型: ${ACTION_LABELS[d.action]}\n` +
            `  优先级: ${PRIORITY_LABELS[d.priority]}\n` +
            `  数据状态: ${d.dataStatus}\n` +
            `  原因: ${d.reason}\n` +
            `  约束草案:\n${d.constraints.map((c) => `    - ${c}`).join("\n")}\n`
        )
        .join("\n---\n");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
      setTimeout(() => setCopyError(false), 3000);
    }
  };

  if (loading) {
    return (
      <div className="py-6 text-center text-xs text-white/40">正在生成配置约束草案…</div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-white/35">
        <Info className="w-4 h-4 mx-auto mb-2 text-white/25" />
        暂无研究候选
        <p className="mt-1 text-white/25">先在「基金研究」页加入配置候选</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 说明条 */}
      <div className="flex items-start gap-2 text-[10px] text-white/30">
        <FileText className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>这是研究约束草案，不会自动修改组合。</span>
      </div>

      {/* 复制按钮 */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] hover:bg-white/[0.07] text-white/60 hover:text-white/80 transition-colors border border-white/[0.06]"
        >
          {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-[#16C784]" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "已复制" : "复制草案"}
        </button>
        {copyError && (
          <span className="text-[10px] text-[#EE6666]">复制失败，请手动复制</span>
        )}
      </div>

      {/* 桌面端表格 */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-white/50 border-b border-white/[0.06]">
              {["基金", "推断资产大类", "建议类型", "优先级", "数据状态", "约束草案", "原因"].map((h) => (
                <th key={h} className="text-left py-2 px-2 font-normal whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {drafts.map((d) => (
              <tr key={d.fundCode} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                <td className="py-2 px-2 align-top">
                  <div className="flex items-center gap-2">
                    <Link to={`/${d.fundCode}`} className="data-number text-[#5AA9FF] hover:underline">
                      {d.fundCode}
                    </Link>
                    <span className="text-white/70">{d.fundName}</span>
                  </div>
                </td>
                <td className="py-2 px-2 align-top whitespace-nowrap">
                  <span className="text-white/60">{d.assetClassLabel}</span>
                </td>
                <td className="py-2 px-2 align-top whitespace-nowrap">
                  <span className={`inline-flex items-center gap-1 ${ACTION_COLORS[d.action]}`}>
                    <ActionIcon action={d.action} />
                    {ACTION_LABELS[d.action]}
                  </span>
                </td>
                <td className="py-2 px-2 align-top whitespace-nowrap">
                  <span className={PRIORITY_COLORS[d.priority]}>{PRIORITY_LABELS[d.priority]}</span>
                </td>
                <td className="py-2 px-2 align-top whitespace-nowrap">
                  <DataStatusBadge status={d.dataStatus} />
                </td>
                <td className="py-2 px-2 align-top">
                  <div className="space-y-0.5">
                    {d.constraints.map((c, i) => (
                      <div
                        key={i}
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${ACTION_BG[d.action]} text-white/60`}
                      >
                        {c}
                      </div>
                    ))}
                  </div>
                </td>
                <td className="py-2 px-2 align-top">
                  <span className="text-white/50 text-[11px]">{d.reason}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 移动端卡片 */}
      <div className="md:hidden space-y-3">
        {drafts.map((d) => (
          <div
            key={d.fundCode}
            className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Link to={`/${d.fundCode}`} className="data-number text-[#5AA9FF] hover:underline text-sm">
                  {d.fundCode}
                </Link>
                <span className="text-white/70 text-sm">{d.fundName}</span>
              </div>
              <DataStatusBadge status={d.dataStatus} />
            </div>

            <div className="grid grid-cols-2 gap-2 text-[10px] text-white/40">
              <div>
                <span className="text-white/25">资产大类:</span> {d.assetClassLabel}
              </div>
              <div>
                <span className="text-white/25">建议类型:</span>{" "}
                <span className={ACTION_COLORS[d.action]}>{ACTION_LABELS[d.action]}</span>
              </div>
              <div>
                <span className="text-white/25">优先级:</span>{" "}
                <span className={PRIORITY_COLORS[d.priority]}>{PRIORITY_LABELS[d.priority]}</span>
              </div>
            </div>

            <div className="space-y-1">
              {d.constraints.map((c, i) => (
                <div
                  key={i}
                  className={`text-[10px] px-1.5 py-0.5 rounded border ${ACTION_BG[d.action]} text-white/60`}
                >
                  {c}
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-white/[0.04]">
              <span className="text-[11px] text-white/50">{d.reason}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
