/**
 * ResearchReportExportPanel
 *
 * 研究报告导出面板：优先使用后端可复现 Markdown 报告。
 * 后端报告缺失时，只导出带有 partial/missingReason 标注的当前页面上下文快照。
 */

import { useState, useMemo } from "react";
import { FileText, Copy, CheckCircle2, Download, ChevronDown, ChevronUp } from "lucide-react";
import { trpc } from "@/providers/trpc";
import {
  generateResearchReportMarkdown,
  generateConstraintDraft,
} from "@/lib/fund-research";
import type { BacktestResponse } from "@/types/backtest";
import type { ParsedDcaResult } from "@/lib/execution-plan";

interface Props {
  portfolioFunds: any[];
  candidates: any[];
  backtestResult?: BacktestResponse | null;
  dcaResult?: ParsedDcaResult | null;
  loading?: boolean;
}

export default function ResearchReportExportPanel({ portfolioFunds, candidates, backtestResult, dcaResult, loading }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const primaryCode = String(
    portfolioFunds?.[0]?.fundCode ||
    portfolioFunds?.[0]?.code ||
    candidates?.[0]?.fundCode ||
    candidates?.[0]?.code ||
    "",
  );
  const backendReportQ = trpc.fund.fundResearchReport.useQuery(
    { code: primaryCode },
    { enabled: /^\d{6}$/.test(primaryCode), staleTime: 30 * 60 * 1000, refetchOnWindowFocus: false },
  );
  const hasPrimaryCode = /^\d{6}$/.test(primaryCode);

  const constraintDrafts = useMemo(
    () => generateConstraintDraft(candidates, portfolioFunds),
    [candidates, portfolioFunds]
  );

  const contextSnapshotMarkdown = useMemo(
    () =>
      generateResearchReportMarkdown({
        portfolioFunds,
        candidates,
        constraintDrafts,
        backtestResult,
        dcaResult,
      }),
    [portfolioFunds, candidates, constraintDrafts, backtestResult, dcaResult]
  );
  const backendMarkdown = typeof backendReportQ.data?.markdown === "string" ? backendReportQ.data.markdown.trim() : "";
  const backendStatus = backendReportQ.data?.dataStatus || (backendReportQ.isError ? "missing" : null);
  const backendMissingReason = backendReportQ.data?.missingReason || (backendReportQ.isError ? "后端研究报告读取失败" : "");
  const hasBackendReport = backendMarkdown.length > 0 && backendStatus !== "missing";
  const reportLoading = hasPrimaryCode && backendReportQ.isLoading;
  const reportSource = hasBackendReport
    ? "backend"
    : hasPrimaryCode
    ? "context_partial"
    : "context_no_primary_code";
  const markdown = useMemo(() => {
    if (hasBackendReport) return backendMarkdown;

    const reason = hasPrimaryCode
      ? backendMissingReason || "后端证据包报告暂不可用"
      : "当前组合缺少可用于后端证据包报告的主基金代码";
    const status = hasPrimaryCode && backendStatus === "missing" ? "missing" : "partial";
    return [
      `> 数据状态：${status}`,
      `> 导出来源：当前页面实时上下文快照，不是后端证据包报告。`,
      `> 后端报告状态：${hasPrimaryCode ? (backendStatus || "pending") : "disabled"}；原因：${reason}`,
      "",
      contextSnapshotMarkdown,
    ].join("\n");
  }, [backendMarkdown, backendMissingReason, backendStatus, contextSnapshotMarkdown, hasBackendReport, hasPrimaryCode]);

  const handleCopy = async () => {
    if (reportLoading) return;
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
      setTimeout(() => setCopyError(false), 3000);
    }
  };

  const handleDownload = () => {
    if (reportLoading) return;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const h = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");
    const filename = `fund-research-report-${y}${m}${d}-${h}${min}.md`;

    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="py-6 text-center text-xs text-white/40">正在生成研究报告…</div>
    );
  }

  const previewLines = markdown.split("\n").slice(0, 8);
  const sourceLabel = reportSource === "backend"
    ? "后端证据包报告"
    : reportSource === "context_partial"
    ? "当前上下文快照（后端报告缺失）"
    : "当前上下文快照（未匹配主基金）";

  return (
    <div className="space-y-4">
      {/* 说明条 */}
      <div className="flex items-start gap-2 text-[10px] text-white/30">
        <FileText className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          报告来源：{sourceLabel}
          {reportLoading && "；后端报告读取中，导出按钮暂不可用。"}
          {!hasBackendReport && hasPrimaryCode && !reportLoading && backendMissingReason && `；${backendMissingReason}。`}
        </span>
      </div>

      {/* 按钮组 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleCopy}
          disabled={reportLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] hover:bg-white/[0.07] text-white/60 hover:text-white/80 transition-colors border border-white/[0.06] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-[#16C784]" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "已复制" : "复制 Markdown"}
        </button>
        <button
          onClick={handleDownload}
          disabled={reportLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] hover:bg-white/[0.07] text-white/60 hover:text-white/80 transition-colors border border-white/[0.06] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5" />
          下载 Markdown
        </button>
        {copyError && (
          <span className="text-[10px] text-[#EE6666]">复制失败，请手动复制</span>
        )}
      </div>

      {/* 预览区域 */}
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02]">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs text-white/50 hover:text-white/70 transition-colors"
        >
          <span>Markdown 预览</span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        <div
          className={`px-3 pb-3 overflow-x-auto transition-all ${expanded ? "" : "max-h-32 overflow-y-hidden"}`}
        >
          <pre className="text-[10px] text-white/40 whitespace-pre-wrap font-mono leading-relaxed">
            {expanded ? markdown : previewLines.join("\n") + "\n..."}
          </pre>
        </div>
      </div>
    </div>
  );
}
