/**
 * ResearchReportExportPanel
 *
 * 研究报告导出面板：将当前组合、候选池、匹配分析、约束草案整理成 Markdown 报告，
 * 支持复制到剪贴板或下载为 .md 文件。
 *
 * 约束：
 * - 不自动改权重
 * - 不调用后端
 * - 不持久化
 */

import { useState, useMemo } from "react";
import { FileText, Copy, CheckCircle2, Download, ChevronDown, ChevronUp } from "lucide-react";
import {
  generateResearchReportMarkdown,
  generateConstraintDraft,
} from "@/lib/fund-research";

interface Props {
  portfolioFunds: any[];
  candidates: any[];
  loading?: boolean;
}

export default function ResearchReportExportPanel({ portfolioFunds, candidates, loading }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const constraintDrafts = useMemo(
    () => generateConstraintDraft(candidates, portfolioFunds),
    [candidates, portfolioFunds]
  );

  const markdown = useMemo(
    () =>
      generateResearchReportMarkdown({
        portfolioFunds,
        candidates,
        constraintDrafts,
      }),
    [portfolioFunds, candidates, constraintDrafts]
  );

  const handleCopy = async () => {
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

  return (
    <div className="space-y-4">
      {/* 说明条 */}
      <div className="flex items-start gap-2 text-[10px] text-white/30">
        <FileText className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>导出当前组合、研究候选池、匹配分析和配置约束草案。</span>
      </div>

      {/* 按钮组 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] hover:bg-white/[0.07] text-white/60 hover:text-white/80 transition-colors border border-white/[0.06]"
        >
          {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-[#16C784]" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "已复制" : "复制 Markdown"}
        </button>
        <button
          onClick={handleDownload}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] hover:bg-white/[0.07] text-white/60 hover:text-white/80 transition-colors border border-white/[0.06]"
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
