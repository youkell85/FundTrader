import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Search, Filter, Star, Trash2, Plus, Minus, TrendingUp, TrendingDown,
  BarChart3, AlertTriangle, CheckCircle2, X, LayoutList, Eye,
  ArrowUpDown, Database, Shield,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import {
  RISK_COLOR, POSITIVE_METRIC_COLOR, getChangeTextClass,
} from "@/lib/colors";

const typeLabels: Record<string, string> = {
  equity: "股票型", hybrid: "混合型", bond: "债券型",
  index: "指数型", etf: "ETF", qdii: "QDII",
  money: "货币型", fof: "FOF", reits: "REITs",
};

const dataStatusConfig: Record<string, { label: string; color: string; bg: string }> = {
  available: { label: "完整", color: "#16C784", bg: "rgba(22,199,132,0.08)" },
  partial: { label: "部分", color: "#FAC858", bg: "rgba(250,200,88,0.08)" },
  stale: { label: "陈旧", color: "#5AA9FF", bg: "rgba(90,169,255,0.08)" },
  missing: { label: "缺失", color: "#EE6666", bg: "rgba(238,102,102,0.08)" },
};

function fmtNum(v: unknown, digits = 2, suffix = ""): string {
  if (v === undefined || v === null || v === "" || v === "—") return "—";
  const n = typeof v === "number" ? v : parseFloat(String(v).replace("%", ""));
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}${suffix}`;
}

function parseNum(v: unknown): number | null {
  if (v === undefined || v === null || v === "" || v === "—") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

function getDataStatus(fund: any): string {
  const dq = fund.dataQuality || "unknown";
  const sl = fund.staleLevel || "unknown";
  if (dq === "missing" || sl === "missing") return "missing";
  if (dq === "partial") return "partial";
  if (sl === "stale" || sl === "very_stale") return "stale";
  if (dq === "ok" || dq === "available" || dq === "seeded") return "available";
  if (sl === "fresh") return "available";
  return "partial";
}

function generateResearchNotes(fund: any): string[] {
  const perf = fund.performance || {};
  const notes: string[] = [];
  const r1y = parseNum(perf.return1y);
  const sharpe = parseNum(perf.sharpeRatio);
  const mdd = parseNum(perf.maxDrawdown);
  const scale = parseNum(fund.totalScale);
  const feeM = parseNum(fund.feeManage);
  const status = getDataStatus(fund);

  if (r1y !== null) {
    notes.push(`${r1y >= 0 ? "近1年收益" : "近1年亏损"}${fmtNum(r1y, 2, "%")}，${Math.abs(r1y) > 15 ? "弹性较大" : "波动适中"}`);
  }
  if (sharpe !== null && mdd !== null) {
    notes.push(`夏普${fmtNum(sharpe, 2)} / 回撤${fmtNum(mdd, 2, "%")}，${sharpe > 1 ? "风险收益比优秀" : sharpe > 0.5 ? "风险收益比尚可" : "风险收益比偏弱"}`);
  }
  if (scale !== null) {
    notes.push(`规模${scale >= 10 ? `${fmtNum(scale, 1)}亿` : `${fmtNum(scale * 10000, 0)}万`}${scale > 100 ? "，超大规模" : scale > 10 ? "，中大型" : "，规模较小"}`);
  }
  if (feeM !== null) {
    notes.push(`管理费率${fmtNum(feeM * 100, 2, "%")}${feeM > 0.015 ? "，费率偏高" : feeM < 0.008 ? "，费率较低" : ""}`);
  }
  if (status === "missing") {
    notes.push("数据缺失严重，建议等待数据补充后再评估");
  } else if (status === "stale") {
    notes.push("数据陈旧，近期指标可能不代表当前状态");
  } else if (status === "partial") {
    notes.push("部分指标缺失，评估可能不完整");
  }
  return notes.slice(0, 3);
}

interface Props {
  funds: any[];
}

export default function ResearchWorkbench({ funds }: Props) {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [fundType, setFundType] = useState("__all__");
  const [company, setCompany] = useState("__all__");
  const [riskLevel, setRiskLevel] = useState("__all__");
  const [minReturn1y, setMinReturn1y] = useState<string>("");
  const [maxDrawdown, setMaxDrawdown] = useState<string>("");
  const [minSharpe, setMinSharpe] = useState<string>("");
  const [dataStatusFilter, setDataStatusFilter] = useState<string>("__all__");
  const [sortBy, setSortBy] = useState<string>("return1y");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [compareCodes, setCompareCodes] = useState<string[]>([]);
  const [showComparePanel, setShowComparePanel] = useState(false);

  const addByCode = trpc.fund.addByCode.useMutation({
    onSuccess: () => utils.fund.list.invalidate(),
  });
  const removeFund = trpc.fund.removeFromWatchlist.useMutation({
    onSuccess: () => utils.fund.list.invalidate(),
  });
  const addResearchCandidate = trpc.fund.addResearchCandidate.useMutation({
    onSuccess: () => utils.fund.listResearchCandidates.invalidate(),
  });
  const removeResearchCandidate = trpc.fund.removeResearchCandidate.useMutation({
    onSuccess: () => utils.fund.listResearchCandidates.invalidate(),
  });
  const { data: candidateData } = trpc.fund.listResearchCandidates.useQuery(undefined, {
    enabled: !!user,
    staleTime: 30_000,
  });
  const candidateCodes = new Set((candidateData?.funds || []).map((f: any) => f.fundCode));

  // 筛选 + 排序
  const filtered = useMemo(() => {
    let result = [...funds];
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      result = result.filter((f) =>
        f.fundCode?.includes(s) ||
        f.fundName?.toLowerCase().includes(s) ||
        f.fundAbbr?.toLowerCase().includes(s)
      );
    }
    if (fundType !== "__all__") result = result.filter((f) => f.fundType === fundType);
    if (company !== "__all__") result = result.filter((f) => f.company?.includes(company));
    if (riskLevel !== "__all__") result = result.filter((f) => f.riskLevel === riskLevel);

    const minR = parseFloat(minReturn1y);
    if (!Number.isNaN(minR)) {
      result = result.filter((f) => {
        const v = parseNum(f.performance?.return1y);
        return v !== null && v >= minR;
      });
    }
    const maxD = parseFloat(maxDrawdown);
    if (!Number.isNaN(maxD)) {
      result = result.filter((f) => {
        const v = parseNum(f.performance?.maxDrawdown);
        return v !== null && Math.abs(v) <= Math.abs(maxD);
      });
    }
    const minS = parseFloat(minSharpe);
    if (!Number.isNaN(minS)) {
      result = result.filter((f) => {
        const v = parseNum(f.performance?.sharpeRatio);
        return v !== null && v >= minS;
      });
    }
    if (dataStatusFilter !== "__all__") {
      result = result.filter((f) => getDataStatus(f) === dataStatusFilter);
    }

    result.sort((a, b) => {
      let aVal: number | null = null;
      let bVal: number | null = null;
      if (sortBy === "return1y") {
        aVal = parseNum(a.performance?.return1y);
        bVal = parseNum(b.performance?.return1y);
      } else if (sortBy === "sharpe") {
        aVal = parseNum(a.performance?.sharpeRatio);
        bVal = parseNum(b.performance?.sharpeRatio);
      } else if (sortBy === "maxDrawdown") {
        aVal = parseNum(a.performance?.maxDrawdown);
        bVal = parseNum(b.performance?.maxDrawdown);
      } else if (sortBy === "nav") {
        aVal = parseNum(a.nav);
        bVal = parseNum(b.nav);
      } else if (sortBy === "scale") {
        aVal = parseNum(a.totalScale);
        bVal = parseNum(b.totalScale);
      } else if (sortBy === "fee") {
        aVal = parseNum(a.feeManage);
        bVal = parseNum(b.feeManage);
      }
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      return sortOrder === "desc" ? bVal - aVal : aVal - bVal;
    });

    return result;
  }, [funds, search, fundType, company, riskLevel, minReturn1y, maxDrawdown, minSharpe, dataStatusFilter, sortBy, sortOrder]);

  const companies = useMemo(() => {
    const set = new Set<string>();
    funds.forEach((f) => { if (f.company && f.company !== "—") set.add(f.company); });
    return Array.from(set).sort();
  }, [funds]);

  const toggleCompare = (code: string) => {
    setCompareCodes((prev) => {
      if (prev.includes(code)) return prev.filter((c) => c !== code);
      if (prev.length >= 4) return prev;
      return [...prev, code];
    });
  };

  const compareFunds = useMemo(() => {
    return compareCodes.map((code) => funds.find((f) => f.fundCode === code)).filter(Boolean);
  }, [compareCodes, funds]);

  const sortBtn = (key: string, label: string) => {
    const active = sortBy === key;
    return (
      <button
        onClick={() => {
          if (active) setSortOrder((o) => (o === "desc" ? "asc" : "desc"));
          else { setSortBy(key); setSortOrder("desc"); }
        }}
        className={`text-[10px] px-2 py-1 rounded border transition-colors flex items-center gap-0.5 ${
          active ? "border-[#3B6CFF]/40 bg-[#3B6CFF]/10 text-[#5AA9FF]" : "border-white/[0.06] bg-white/[0.02] text-white/40 hover:text-white/60"
        }`}
      >
        {label}
        {active && <ArrowUpDown className="w-2.5 h-2.5" />}
      </button>
    );
  };

  return (
    <section className="space-y-4 md:space-y-6 mt-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5" style={{ color: "#3B6CFF" }} />
            基金研究
          </h2>
          <p className="text-xs text-white/40 mt-1">
            共 {funds.length} 只产品 · 筛选后 {filtered.length} 只
            {compareCodes.length > 0 && (
              <span className="ml-2 text-[#3B6CFF]">已选 {compareCodes.length}/4 只对比</span>
            )}
          </p>
        </div>
        {compareCodes.length > 0 && (
          <button
            onClick={() => setShowComparePanel((s) => !s)}
            className="px-3 py-1.5 rounded-lg text-xs bg-[#3B6CFF]/15 text-[#3B6CFF] border border-[#3B6CFF]/25 hover:bg-[#3B6CFF]/25 transition-colors"
          >
            {showComparePanel ? "收起对比" : "展开对比"}
          </button>
        )}
      </div>

      {/* Compare Panel */}
      {showComparePanel && compareFunds.length > 0 && (
        <div className="liquid-glass p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-white">基金对比</h3>
            <button onClick={() => { setCompareCodes([]); setShowComparePanel(false); }} className="text-white/40 hover:text-white/70">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left py-2 pr-4 text-white/50 font-normal">指标</th>
                  {compareFunds.map((f) => (
                    <th key={f.fundCode} className="text-left py-2 px-2 text-white/70 font-normal min-w-[140px]">
                      <div className="truncate max-w-[160px]">{f.fundAbbr || f.fundName}</div>
                      <div className="text-white/40 text-[10px]">{f.fundCode}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-white/70">
                {[
                  { label: "类型", get: (f: any) => typeLabels[f.fundType] || f.fundType || "—" },
                  { label: "公司", get: (f: any) => f.company || "—" },
                  { label: "净值", get: (f: any) => fmtNum(f.nav) },
                  { label: "日涨跌", get: (f: any) => {
                    const v = parseNum(f.dailyChange);
                    return v === null ? "—" : <span className={v >= 0 ? "text-[#16C784]" : "text-[#EE6666]"}>{v >= 0 ? "+" : ""}{fmtNum(v, 2, "%")}</span>;
                  }},
                  { label: "近1年收益", get: (f: any) => {
                    const v = parseNum(f.performance?.return1y);
                    return v === null ? "—" : <span className={v >= 0 ? "text-[#16C784]" : "text-[#EE6666]"}>{v >= 0 ? "+" : ""}{fmtNum(v, 2, "%")}</span>;
                  }},
                  { label: "最大回撤", get: (f: any) => <span className="text-[#EE6666]">{fmtNum(f.performance?.maxDrawdown, 2, "%")}</span> },
                  { label: "Sharpe", get: (f: any) => fmtNum(f.performance?.sharpeRatio, 2) },
                  { label: "波动率", get: (f: any) => fmtNum(f.performance?.annualizedVolatility, 2, "%") },
                  { label: "规模", get: (f: any) => fmtNum(f.totalScale, 1, "亿") },
                  { label: "管理费率", get: (f: any) => fmtNum(f.feeManage, 3) },
                  { label: "数据状态", get: (f: any) => {
                    const s = getDataStatus(f);
                    const cfg = dataStatusConfig[s] || dataStatusConfig.partial;
                    return <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ color: cfg.color, background: cfg.bg }}>{cfg.label}</span>;
                  }},
                ].map((row, i) => (
                  <tr key={i} className="border-b border-white/[0.03]">
                    <td className="py-2 pr-4 text-white/50 whitespace-nowrap">{row.label}</td>
                    {compareFunds.map((f) => (
                      <td key={f.fundCode} className="py-2 px-2">{row.get(f)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="liquid-glass p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索代码/名称"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white text-xs placeholder:text-white/25 focus:outline-none focus:border-[#3B6CFF]/30"
            />
          </div>
          <select
            value={fundType}
            onChange={(e) => setFundType(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white text-xs focus:outline-none"
          >
            <option value="__all__">全部类型</option>
            {Object.entries(typeLabels).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white text-xs focus:outline-none max-w-[160px]"
          >
            <option value="__all__">全部公司</option>
            {companies.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={riskLevel}
            onChange={(e) => setRiskLevel(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white text-xs focus:outline-none"
          >
            <option value="__all__">全部风险</option>
            <option value="low">低</option>
            <option value="low_medium">中低</option>
            <option value="medium">中</option>
            <option value="medium_high">中高</option>
            <option value="high">高</option>
          </select>
          <select
            value={dataStatusFilter}
            onChange={(e) => setDataStatusFilter(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white text-xs focus:outline-none"
          >
            <option value="__all__">全部状态</option>
            <option value="available">完整</option>
            <option value="partial">部分</option>
            <option value="stale">陈旧</option>
            <option value="missing">缺失</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[10px] text-white/30">排序:</span>
          {sortBtn("return1y", "近1年收益")}
          {sortBtn("sharpe", "Sharpe")}
          {sortBtn("maxDrawdown", "回撤")}
          {sortBtn("nav", "净值")}
          {sortBtn("scale", "规模")}
          {sortBtn("fee", "费率")}
          <div className="ml-auto flex gap-2">
            <input
              type="number"
              value={minReturn1y}
              onChange={(e) => setMinReturn1y(e.target.value)}
              placeholder="最小收益%"
              className="w-20 px-2 py-1 rounded bg-white/[0.03] border border-white/[0.06] text-white text-[10px] placeholder:text-white/20 focus:outline-none"
            />
            <input
              type="number"
              value={maxDrawdown}
              onChange={(e) => setMaxDrawdown(e.target.value)}
              placeholder="最大回撤%"
              className="w-20 px-2 py-1 rounded bg-white/[0.03] border border-white/[0.06] text-white text-[10px] placeholder:text-white/20 focus:outline-none"
            />
            <input
              type="number"
              value={minSharpe}
              onChange={(e) => setMinSharpe(e.target.value)}
              placeholder="最小Sharpe"
              className="w-20 px-2 py-1 rounded bg-white/[0.03] border border-white/[0.06] text-white text-[10px] placeholder:text-white/20 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Fund Table */}
      <div className="liquid-glass overflow-hidden">
        {/* Desktop header */}
        <div className="hidden md:grid md:grid-cols-[minmax(220px,2fr)_repeat(6,minmax(72px,1fr))_minmax(160px,1fr)_minmax(100px,1fr)] gap-2 px-4 py-2.5 text-[10px] text-white/40 font-medium border-b border-white/[0.06] items-center">
          <div>基金</div>
          <div className="text-right">净值</div>
          <div className="text-right">近1年</div>
          <div className="text-right">回撤</div>
          <div className="text-right">Sharpe</div>
          <div className="text-right">规模</div>
          <div className="text-right">费率</div>
          <div>研究摘要</div>
          <div className="text-center">操作</div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-8 text-center text-white/40 text-sm">
            <Database className="w-8 h-8 mx-auto mb-2 text-white/15" />
            暂无符合条件的基金
          </div>
        ) : (
          filtered.map((fund) => {
            const perf = fund.performance || {};
            const daily = parseNum(fund.dailyChange) ?? 0;
            const r1y = parseNum(perf.return1y);
            const sharpe = parseNum(perf.sharpeRatio);
            const mdd = parseNum(perf.maxDrawdown);
            const isWatchlist = fund.source === "watchlist";
            const status = getDataStatus(fund);
            const statusCfg = dataStatusConfig[status] || dataStatusConfig.partial;
            const notes = generateResearchNotes(fund);
            const isCompare = compareCodes.includes(fund.fundCode);

            return (
              <div key={fund.fundCode} className="border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors">
                {/* Desktop row */}
                <div className="hidden md:grid md:grid-cols-[minmax(220px,2fr)_repeat(6,minmax(72px,1fr))_minmax(160px,1fr)_minmax(100px,1fr)] gap-2 px-4 py-2.5 text-xs items-center">
                  <div className="min-w-0">
                    <Link to={`/${fund.fundCode}`} className="text-white font-medium hover:text-[#3B6CFF] transition-colors truncate block">
                      {fund.fundAbbr || fund.fundName}
                    </Link>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-white/40 text-[10px]">{fund.fundCode}</span>
                      <span className="px-1 py-0 rounded text-[9px] bg-white/[0.05] text-white/40">{typeLabels[fund.fundType] || fund.fundType}</span>
                      <span className="px-1 py-0 rounded text-[9px]" style={{ color: statusCfg.color, background: statusCfg.bg }}>{statusCfg.label}</span>
                    </div>
                  </div>
                  <div className="text-right data-number text-white/70">{fmtNum(fund.nav)}</div>
                  <div className={`text-right data-number ${r1y !== null && r1y >= 0 ? "text-[#16C784]" : "text-[#EE6666]"}`}>
                    {r1y !== null ? `${r1y >= 0 ? "+" : ""}${fmtNum(r1y, 2, "%")}` : "—"}
                  </div>
                  <div className="text-right data-number text-[#EE6666]">{fmtNum(perf.maxDrawdown, 2, "%")}</div>
                  <div className="text-right data-number" style={{ color: POSITIVE_METRIC_COLOR }}>{fmtNum(perf.sharpeRatio, 2)}</div>
                  <div className="text-right data-number text-white/50">{fmtNum(fund.totalScale, 1, "亿")}</div>
                  <div className="text-right data-number text-white/50">{fmtNum(fund.feeManage, 3)}</div>
                  <div className="text-[10px] text-white/40 leading-tight space-y-0.5">
                    {notes.map((n, i) => (
                      <div key={i} className="truncate" title={n}>• {n}</div>
                    ))}
                  </div>
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => toggleCompare(fund.fundCode)}
                      className={`p-1 rounded transition-colors ${isCompare ? "bg-[#3B6CFF]/20 text-[#3B6CFF]" : "text-white/30 hover:text-white/60 hover:bg-white/[0.06]"}`}
                      title={isCompare ? "取消对比" : "加入对比"}
                    >
                      {isCompare ? <Minus className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                    </button>
                    <Link to={`/${fund.fundCode}`} className="p-1 rounded text-white/30 hover:text-white/60 hover:bg-white/[0.06]" title="查看详情">
                      <Eye className="w-3.5 h-3.5" />
                    </Link>
                    {user && (
                      <>
                        {candidateCodes.has(fund.fundCode) ? (
                          <button
                            onClick={() => removeResearchCandidate.mutate({ code: fund.fundCode })}
                            className="p-1 rounded text-[#9D7BFF]/60 hover:text-[#9D7BFF] hover:bg-[#9D7BFF]/10"
                            title="移出候选"
                          >
                            <Shield className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => addResearchCandidate.mutate({ code: fund.fundCode })}
                            className="p-1 rounded text-white/30 hover:text-[#9D7BFF] hover:bg-[#9D7BFF]/10"
                            title="加入候选池"
                          >
                            <Shield className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isWatchlist ? (
                          <button
                            onClick={() => removeFund.mutate({ code: fund.fundCode })}
                            className="p-1 rounded text-[#EE6666]/60 hover:text-[#EE6666] hover:bg-[#EE6666]/10"
                            title="移出自选"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => addByCode.mutate({ code: fund.fundCode })}
                            className="p-1 rounded text-[#16C784]/60 hover:text-[#16C784] hover:bg-[#16C784]/10"
                            title="加入自选"
                          >
                            <Star className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Mobile card */}
                <div className="md:hidden px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <Link to={`/${fund.fundCode}`} className="text-white text-sm font-medium hover:text-[#3B6CFF] truncate block">
                        {fund.fundAbbr || fund.fundName}
                      </Link>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-white/40 text-[10px]">{fund.fundCode}</span>
                        <span className="px-1 py-0 rounded text-[9px] bg-white/[0.05] text-white/40">{typeLabels[fund.fundType] || fund.fundType}</span>
                        <span className="px-1 py-0 rounded text-[9px]" style={{ color: statusCfg.color, background: statusCfg.bg }}>{statusCfg.label}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => toggleCompare(fund.fundCode)} className={`p-1.5 rounded ${isCompare ? "bg-[#3B6CFF]/20 text-[#3B6CFF]" : "text-white/30"}`}>
                        {isCompare ? <Minus className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                      </button>
                      {user && (
                        <>
                          {candidateCodes.has(fund.fundCode) ? (
                            <button onClick={() => removeResearchCandidate.mutate({ code: fund.fundCode })} className="p-1.5 rounded text-[#9D7BFF]/60">
                              <Shield className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button onClick={() => addResearchCandidate.mutate({ code: fund.fundCode })} className="p-1.5 rounded text-white/30">
                              <Shield className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {isWatchlist ? (
                            <button onClick={() => removeFund.mutate({ code: fund.fundCode })} className="p-1.5 rounded text-[#EE6666]/60">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button onClick={() => addByCode.mutate({ code: fund.fundCode })} className="p-1.5 rounded text-[#16C784]/60">
                              <Star className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 mt-2">
                    <div className="text-center">
                      <div className="text-[9px] text-white/30">净值</div>
                      <div className="text-xs data-number text-white/70">{fmtNum(fund.nav)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[9px] text-white/30">近1年</div>
                      <div className={`text-xs data-number ${r1y !== null && r1y >= 0 ? "text-[#16C784]" : "text-[#EE6666]"}`}>
                        {r1y !== null ? `${r1y >= 0 ? "+" : ""}${fmtNum(r1y, 1, "%")}` : "—"}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[9px] text-white/30">回撤</div>
                      <div className="text-xs data-number text-[#EE6666]">{fmtNum(perf.maxDrawdown, 1, "%")}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[9px] text-white/30">Sharpe</div>
                      <div className="text-xs data-number" style={{ color: POSITIVE_METRIC_COLOR }}>{fmtNum(perf.sharpeRatio, 2)}</div>
                    </div>
                  </div>
                  <div className="text-[10px] text-white/35 mt-1.5 space-y-0.5">
                    {notes.map((n, i) => <div key={i} className="truncate">• {n}</div>)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
