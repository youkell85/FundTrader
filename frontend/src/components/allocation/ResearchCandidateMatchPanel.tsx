/**
 * ResearchCandidateMatchPanel
 *
 * 候选池匹配分析面板：将研究候选基金与当前资产配置组合做轻量规则比对，
 * 输出资产类别推断、数据完整性、关键优势和研究建议。
 *
 * 约束：
 * - 不自动改权重
 * - 不调用 LLM
 * - 不展示假数据
 */

import { Link } from "react-router";
import { Shield, AlertTriangle, CheckCircle2, Info, TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import { feePct, returnPct, drawdownPct, sharpeFmt } from "@/lib/fund-data";
import {
  analyzeCandidatePool,
  ASSET_CLASS_LABELS,
  type CandidateMatchResult,
} from "@/lib/fund-research";
import type { FundItem } from "@/types/allocation";

interface Props {
  candidates: any[];
  portfolioFunds: FundItem[];
  loading?: boolean;
}

function DataStatusBadge({ status }: { status: CandidateMatchResult["dataStatus"] }) {
  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-[#16C784]">
        <CheckCircle2 className="w-3 h-3" /> 数据完整
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
      <AlertTriangle className="w-3 h-3" /> 数据不足
    </span>
  );
}

function AdvantageChip({ label }: { label: string }) {
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-white/[0.04] text-white/50 border border-white/[0.06]">
      {label}
    </span>
  );
}

export default function ResearchCandidateMatchPanel({ candidates, portfolioFunds, loading }: Props) {
  if (loading) {
    return (
      <div className="py-6 text-center text-xs text-white/40">
        正在分析候选基金与当前组合的匹配关系…
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-white/35">
        <Info className="w-4 h-4 mx-auto mb-2 text-white/25" />
        暂无候选基金
        <p className="mt-1 text-white/25">在「基金研究」页添加候选后，此处将显示匹配分析</p>
      </div>
    );
  }

  const results = analyzeCandidatePool(candidates, portfolioFunds);

  // 汇总统计
  const inPortfolioCount = results.filter((r) => r.match.inPortfolio).length;
  const missingDataCount = results.filter((r) => r.match.dataStatus === "missing").length;

  return (
    <div className="space-y-4">
      {/* 汇总条 */}
      <div className="flex flex-wrap gap-3 text-[10px] text-white/40">
        <span>候选{candidates.length}只</span>
        {inPortfolioCount > 0 && <span className="text-[#5AA9FF]">{inPortfolioCount}只已在组合中</span>}
        {missingDataCount > 0 && <span className="text-[#EE6666]">{missingDataCount}只数据不足</span>}
        <span className="ml-auto text-white/25">本页仅提供研究建议，不自动改权重</span>
      </div>

      {/* 桌面端表格 */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-white/50 border-b border-white/[0.06]">
              {["候选基金", "推断角色", "组合匹配", "关键指标", "数据状态", "研究建议"].map((h) => (
                <th key={h} className="text-left py-2 px-2 font-normal whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map(({ candidate, match }) => {
              const perf = candidate.performance || {};
              return (
                <tr key={candidate.fundCode} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                  <td className="py-2 px-2 align-top">
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/${candidate.fundCode}`}
                        className="data-number text-[#5AA9FF] hover:underline"
                      >
                        {candidate.fundCode}
                      </Link>
                      <span className="text-white/70">{candidate.fundAbbr || candidate.fundName}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {match.advantages.map((a) => (
                        <AdvantageChip key={a} label={a} />
                      ))}
                    </div>
                  </td>
                  <td className="py-2 px-2 align-top whitespace-nowrap">
                    <span className="text-white/60">{ASSET_CLASS_LABELS[match.inferredAsset]}</span>
                    {match.inferredAsset === "unrecognized" && (
                      <span className="ml-1 text-[#EE6666] text-[10px]">未识别</span>
                    )}
                  </td>
                  <td className="py-2 px-2 align-top whitespace-nowrap">
                    {match.inPortfolio ? (
                      <span className="text-[#16C784]">已在组合中</span>
                    ) : match.peerFunds.length > 0 ? (
                      <span className="text-white/50">
                        同类{match.peerFunds.length}只
                      </span>
                    ) : (
                      <span className="text-[#5AA9FF]">新资产类别</span>
                    )}
                  </td>
                  <td className="py-2 px-2 align-top whitespace-nowrap">
                    <div className="space-y-0.5 text-[10px] text-white/40">
                      <div className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" />
                        <span>1年{returnPct(perf.return1y)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <TrendingDown className="w-3 h-3" />
                        <span>回撤{drawdownPct(perf.maxDrawdown)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Shield className="w-3 h-3" />
                        <span>Sharpe {sharpeFmt(perf.sharpeRatio)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <DollarSign className="w-3 h-3" />
                        <span>费率{feePct(candidate.feeManage)}</span>
                      </div>
                    </div>
                  </td>
                  <td className="py-2 px-2 align-top whitespace-nowrap">
                    <DataStatusBadge status={match.dataStatus} />
                    <div className="mt-1 text-[10px] text-white/30">
                      完整度 {Math.round(match.dataCompleteness * 100)}%
                    </div>
                  </td>
                  <td className="py-2 px-2 align-top">
                    <span className="text-white/60 text-[11px]">{match.suggestion}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 移动端卡片 */}
      <div className="md:hidden space-y-3">
        {results.map(({ candidate, match }) => {
          const perf = candidate.performance || {};
          return (
            <div
              key={candidate.fundCode}
              className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Link
                    to={`/${candidate.fundCode}`}
                    className="data-number text-[#5AA9FF] hover:underline text-sm"
                  >
                    {candidate.fundCode}
                  </Link>
                  <span className="text-white/70 text-sm">{candidate.fundAbbr || candidate.fundName}</span>
                </div>
                <DataStatusBadge status={match.dataStatus} />
              </div>

              <div className="flex flex-wrap gap-1">
                {match.advantages.map((a) => (
                  <AdvantageChip key={a} label={a} />
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2 text-[10px] text-white/40">
                <div>
                  <span className="text-white/25">推断角色:</span>{" "}
                  {ASSET_CLASS_LABELS[match.inferredAsset]}
                </div>
                <div>
                  <span className="text-white/25">组合匹配:</span>{" "}
                  {match.inPortfolio ? (
                    <span className="text-[#16C784]">已在组合中</span>
                  ) : match.peerFunds.length > 0 ? (
                    <span>同类{match.peerFunds.length}只</span>
                  ) : (
                    <span className="text-[#5AA9FF]">新资产类别</span>
                  )}
                </div>
                <div>
                  <span className="text-white/25">近1年:</span>{" "}
                  {returnPct(perf.return1y)}
                </div>
                <div>
                  <span className="text-white/25">回撤:</span>{" "}
                  {drawdownPct(perf.maxDrawdown)}
                </div>
                <div>
                  <span className="text-white/25">Sharpe:</span> {sharpeFmt(perf.sharpeRatio)}
                </div>
                <div>
                  <span className="text-white/25">费率:</span> {feePct(candidate.feeManage)}
                </div>
              </div>

              <div className="pt-2 border-t border-white/[0.04]">
                <span className="text-[11px] text-white/60">{match.suggestion}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
