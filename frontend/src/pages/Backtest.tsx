import { useMemo, useState } from "react";
import { Calculator, Play, RotateCcw, Loader2, AlertCircle, Sparkles, Search, Plus, X, Info, CheckCircle2 } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { trpc } from "@/providers/trpc";
import {
  UP_COLOR,
  DOWN_COLOR,
  ACCENT_PRIMARY,
  ACCENT_INFO,
  ACCENT_HIGHLIGHT,
  RISK_COLOR,
  POSITIVE_METRIC_COLOR,
  getChangeTextClass,
} from "@/lib/colors";

const typeLabels: Record<string, string> = {
  equity: "股票型",
  hybrid: "混合型",
  bond: "债券型",
  index: "指数型",
  qdii: "QDII",
  money: "货币型",
  fof: "FOF",
  reits: "REITs",
};

const strategyLabels: Record<string, string> = {
  compare: "多策略对比",
  fixed: "固定金额",
  ratio: "固定比例",
  ma: "价值平均",
  fixed_amount: "固定金额定投",
  fixed_ratio: "固定比例定投",
  value_averaging: "价值平均定投",
  smart_beta: "估值调节定投",
  martingale: "下跌加倍投入",
};

const strategies = [
  { value: "compare", label: "多策略对比", desc: "同时回测固定金额、比例、价值平均和下跌加倍投入，用于横向比较。" },
  { value: "fixed_amount", label: "固定金额定投", desc: "每期投入固定金额，适合工资现金流和长期纪律投资。" },
  { value: "fixed_ratio", label: "固定比例定投", desc: "随市场位置调整投入强度，低位多投、高位少投。" },
  { value: "value_averaging", label: "价值平均定投", desc: "以目标市值为锚，偏离目标时自动调节投入。" },
  { value: "martingale", label: "下跌加倍投入", desc: "下跌后提高投入，回撤期摊薄成本更快，但资金压力更高。" },
];

const frequencies = [
  { value: "weekly", label: "每周" },
  { value: "biweekly", label: "双周" },
  { value: "monthly", label: "每月" },
];

function todayString() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function toNum(value: unknown) {
  const num = parseFloat(String(value ?? "").replace("%", ""));
  return Number.isFinite(num) ? num : 0;
}

function money(value: unknown) {
  return `¥${Math.round(toNum(value)).toLocaleString()}`;
}

export default function Backtest() {
  const { data: listData } = trpc.fund.list.useQuery({ pageSize: 1000 });
  const allFunds = listData?.funds ?? [];

  const [selectedFunds, setSelectedFunds] = useState<number[]>([]);
  const [weights, setWeights] = useState<number[]>([]);
  const [strategy, setStrategy] = useState("compare");
  const [frequency, setFrequency] = useState("monthly");
  const [amount, setAmount] = useState("1000");
  const [startDate, setStartDate] = useState("2023-01-01");
  const [endDate, setEndDate] = useState(todayString());
  const [result, setResult] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [llmReview, setLlmReview] = useState<any>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [fundSearch, setFundSearch] = useState("");
  const [activeType, setActiveType] = useState("all");

  const utils = trpc.useUtils();
  const llmMutation = trpc.fund.analyzeDcaLLM.useMutation();

  const groupedFunds = useMemo(() => {
    const keyword = fundSearch.trim().toLowerCase();
    const groups = new Map<string, any[]>();
    allFunds.forEach((fund: any) => {
      if (selectedFunds.includes(fund.id)) return;
      if (keyword && ![
        fund.fundCode,
        fund.fundName,
        fund.fundAbbr,
        fund.category,
        typeLabels[fund.fundType],
      ].some((item) => String(item || "").toLowerCase().includes(keyword))) return;
      const key = fund.fundType || "other";
      groups.set(key, [...(groups.get(key) || []), fund]);
    });
    return Array.from(groups.entries())
      .map(([type, funds]) => ({ type, label: typeLabels[type] || type || "其他", funds: funds.slice(0, 16) }))
      .sort((a, b) => b.funds.length - a.funds.length);
  }, [allFunds, fundSearch, selectedFunds]);

  const visibleGroups = activeType === "all" ? groupedFunds : groupedFunds.filter((group) => group.type === activeType);
  const selectedFundDetails = selectedFunds.map((id) => allFunds.find((fund: any) => fund.id === id)).filter(Boolean);
  const totalReturnNum = toNum(result?.totalReturn);
  const benchmarkReturnNum = toNum(result?.benchmark?.totalReturn ?? result?.benchmarkReturn);
  const excessNum = totalReturnNum - benchmarkReturnNum;

  const handleAddFund = (fundId: number) => {
    if (selectedFunds.includes(fundId)) return;
    const newFunds = [...selectedFunds, fundId];
    setSelectedFunds(newFunds);
    setWeights(newFunds.map(() => Math.floor(100 / newFunds.length)));
  };

  const handleRemoveFund = (index: number) => {
    const newFunds = selectedFunds.filter((_, i) => i !== index);
    setSelectedFunds(newFunds);
    setWeights(newFunds.map(() => Math.floor(100 / Math.max(1, newFunds.length))));
  };

  const handleRun = async () => {
    if (selectedFunds.length === 0) return;
    const investAmount = parseFloat(amount);
    if (!investAmount || investAmount <= 0) {
      setErrorMsg("单次投入金额必须大于 0");
      return;
    }
    if (new Date(startDate) >= new Date(endDate)) {
      setErrorMsg("起始日期必须早于结束日期");
      return;
    }
    setIsRunning(true);
    setErrorMsg("");
    setLlmReview(null);
    try {
      let normalizedWeights = weights.length ? weights : selectedFunds.map(() => Math.floor(100 / selectedFunds.length));
      const totalW = normalizedWeights.reduce((a, b) => a + b, 0);
      if (totalW !== 100 && totalW > 0) {
        normalizedWeights = normalizedWeights.map((w) => Math.round((w / totalW) * 100));
        normalizedWeights[0] += 100 - normalizedWeights.reduce((a, b) => a + b, 0);
      }
      const data = await utils.fund.runBacktest.fetch({
        fundIds: selectedFunds,
        weights: normalizedWeights,
        strategy: strategy as any,
        startDate,
        endDate,
        investAmount,
        investFrequency: frequency as any,
      });
      setResult(data);
    } catch (err: any) {
      setErrorMsg(err?.message || "回测计算失败，请检查参数后重试");
    } finally {
      setIsRunning(false);
    }
  };

  const handleLLMReview = async () => {
    if (!result || llmLoading) return;
    setLlmLoading(true);
    try {
      const code = result.fundCode || (allFunds.find((fund: any) => fund.id === selectedFunds[0])?.fundCode ?? "");
      const name = result.fundName || (allFunds.find((fund: any) => fund.id === selectedFunds[0])?.fundAbbr ?? code);
      const review = await llmMutation.mutateAsync({
        code,
        name,
        dca: {
          total_invested: result.totalInvested,
          final_value: result.finalValue,
          total_return: result.totalReturn,
          annualized_return: result.annualizedReturn,
          max_drawdown: result.maxDrawdown,
          sharpe_ratio: result.sharpeRatio,
          totalInvested: result.totalInvested,
          finalValue: result.finalValue,
          totalReturn: result.totalReturn,
          annualizedReturn: result.annualizedReturn,
          maxDrawdown: result.maxDrawdown,
          sharpeRatio: result.sharpeRatio,
          strategy: strategyLabels[strategy] || strategy,
          frequency,
        },
        benchmark: result.benchmark || {},
      });
      setLlmReview(review?.review ?? review);
    } catch {
      setLlmReview({ raw: "AI 评价服务暂时不可用，请稍后重试。" });
    } finally {
      setLlmLoading(false);
    }
  };

  return (
    <div className="min-h-screen pt-14 pb-24 md:pb-12">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="pt-8 md:pt-12 pb-6 md:pb-8">
          <h1 className="text-2xl md:text-4xl font-semibold text-white tracking-tight">智能定投与回测</h1>
          <p className="mt-2 text-white/45 text-sm md:text-base">用长期现金流视角比较不同定投策略和一次性买入基准。</p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[430px_1fr] gap-4 md:gap-6">
          <div className="space-y-4">
            <div className="liquid-glass p-4 md:p-5">
              <h2 className="text-base md:text-lg font-medium text-white mb-4 flex items-center gap-2">
                <Calculator className="w-5 h-5" style={{ color: ACCENT_PRIMARY }} />策略配置
              </h2>

              <div className="space-y-4">
                <section>
                  <label className="text-xs text-white/40 mb-2 block">选择基金</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25" />
                    <input
                      value={fundSearch}
                      onChange={(e) => setFundSearch(e.target.value)}
                      placeholder="输入代码、名称、类型筛选"
                      className="w-full h-10 pl-9 pr-3 rounded-lg bg-[#0B1021] border border-white/[0.08] text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-[#3B6CFF]/50"
                    />
                  </div>
                  <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                    <button onClick={() => setActiveType("all")} className={`h-8 px-3 rounded-lg text-xs whitespace-nowrap border ${activeType === "all" ? "bg-[#3B6CFF]/18 border-[#3B6CFF]/35 text-[#00F0FF]" : "bg-white/[0.03] border-white/[0.06] text-white/45"}`}>全部</button>
                    {groupedFunds.map((group) => (
                      <button key={group.type} onClick={() => setActiveType(group.type)} className={`h-8 px-3 rounded-lg text-xs whitespace-nowrap border ${activeType === group.type ? "bg-[#3B6CFF]/18 border-[#3B6CFF]/35 text-[#00F0FF]" : "bg-white/[0.03] border-white/[0.06] text-white/45"}`}>
                        {group.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 max-h-[420px] overflow-y-auto space-y-3 pr-1">
                    {visibleGroups.map((group) => (
                      <div key={group.type} className="rounded-lg border border-white/[0.06] bg-[#070B18]/70 overflow-hidden">
                        <div className="px-3 py-2 text-xs text-white/55 bg-white/[0.03] flex justify-between">
                          <span>{group.label}</span>
                          <span className="data-number">{group.funds.length}</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-1 p-1.5">
                          {group.funds.map((fund: any) => (
                            <button
                              key={fund.id}
                              type="button"
                              onClick={() => handleAddFund(fund.id)}
                              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-white/[0.06] transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5 text-[#5AA9FF] shrink-0" />
                              <div className="min-w-0 flex-1">
                                <div className="text-white/85 text-sm truncate">{fund.fundAbbr || fund.fundName}</div>
                                <div className="text-white/35 text-xs data-number">{fund.fundCode} · {fund.category}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {selectedFundDetails.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {selectedFundDetails.map((fund: any, i: number) => (
                        <div key={fund.id} className="flex items-center gap-2 rounded-lg bg-white/[0.05] border border-white/[0.08] px-3 py-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#00F0FF]" />
                          <span className="text-white text-sm flex-1 truncate">{fund.fundAbbr}</span>
                          <span className="text-white/35 text-xs">{typeLabels[fund.fundType] || fund.category}</span>
                          {selectedFunds.length > 1 && (
                            <input type="number" value={weights[i] || 0}
                              onChange={(e) => { const next = [...weights]; next[i] = parseInt(e.target.value) || 0; setWeights(next); }}
                              className="w-14 h-7 rounded bg-[#0B1021] border border-white/[0.08] text-white text-xs data-number text-center" />
                          )}
                          <button onClick={() => handleRemoveFund(i)} className="text-white/35 hover:text-[#F5384B] p-1" title="移除">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section>
                  <label className="text-xs text-white/40 mb-2 block">定投策略</label>
                  <div className="space-y-1.5">
                    {strategies.map((item) => (
                      <button key={item.value} onClick={() => setStrategy(item.value)}
                        className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all border ${
                          strategy === item.value ? "bg-[#3B6CFF]/15 text-[#5AA9FF] border-[#3B6CFF]/25" : "text-white/55 hover:text-white/75 hover:bg-white/[0.03] border-transparent"
                        }`}>
                        <div className="font-medium">{item.label}</div>
                        <div className="text-[10px] text-white/35 mt-0.5">{item.desc}</div>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/40 mb-1 block">单次投入（元）</label>
                    <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                      className="w-full h-10 px-3 rounded-lg bg-[#0B1021] border border-white/[0.08] text-white text-sm data-number focus:outline-none focus:border-[#3B6CFF]/50" />
                  </div>
                  <div>
                    <label className="text-xs text-white/40 mb-1 block">定投频率</label>
                    <select value={frequency} onChange={(e) => setFrequency(e.target.value)}
                      className="w-full h-10 px-3 rounded-lg bg-[#0B1021] border border-white/[0.08] text-white text-sm focus:outline-none focus:border-[#3B6CFF]/50">
                      {frequencies.map((item) => (<option key={item.value} value={item.value} className="bg-[#0B1021] text-white">{item.label}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-white/40 mb-1 block">起始日期</label>
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                      className="w-full h-10 px-3 rounded-lg bg-[#0B1021] border border-white/[0.08] text-white text-sm focus:outline-none focus:border-[#3B6CFF]/50" />
                  </div>
                  <div>
                    <label className="text-xs text-white/40 mb-1 block">结束日期</label>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                      className="w-full h-10 px-3 rounded-lg bg-[#0B1021] border border-white/[0.08] text-white text-sm focus:outline-none focus:border-[#3B6CFF]/50" />
                  </div>
                </section>

                {errorMsg && (
                  <div className="flex items-start gap-2 text-xs" style={{ color: RISK_COLOR }}>
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}
                <button onClick={handleRun} disabled={selectedFunds.length === 0 || isRunning}
                  className="w-full h-11 rounded-xl bg-gradient-to-r from-[#3B6CFF] to-[#2A52CC] text-white font-medium text-sm flex items-center justify-center gap-2 hover:from-[#4A7CFF] hover:to-[#3A62CC] transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                  {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  {isRunning ? "回测中..." : "开始回测"}
                </button>
              </div>
            </div>
          </div>

          <div>
            {result ? (
              <div className="space-y-4 md:space-y-6">
                <div className="liquid-glass p-4 md:p-6">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <h2 className="text-base md:text-lg font-medium text-white">{strategyLabels[strategy] || "定投策略"}表现</h2>
                      <p className="text-white/40 text-xs md:text-sm mt-1">上方核心指标均为定投策略；买入持有基准使用与定投累计投入相同的期初一次性资金。</p>
                    </div>
                    <div className="text-right">
                      <div className="text-white/30 text-xs">对比基准投入</div>
                      <div className="data-number text-white/75 text-sm">{money(result.totalInvested)}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
                    {[
                      { label: "定投累计投入", value: money(result.totalInvested), color: ACCENT_PRIMARY },
                      { label: "定投期末市值", value: money(result.finalValue), color: POSITIVE_METRIC_COLOR },
                      { label: "定投总收益率", value: `${totalReturnNum >= 0 ? "+" : ""}${toNum(result.totalReturn).toFixed(2)}%`, color: totalReturnNum >= 0 ? UP_COLOR : DOWN_COLOR },
                      { label: "定投现金流年化", value: `${toNum(result.annualizedReturn).toFixed(2)}%`, color: toNum(result.annualizedReturn) >= 0 ? UP_COLOR : DOWN_COLOR },
                      { label: "定投最大回撤", value: `${toNum(result.maxDrawdown).toFixed(2)}%`, color: RISK_COLOR },
                      { label: "定投夏普比率", value: toNum(result.sharpeRatio).toFixed(2), color: POSITIVE_METRIC_COLOR },
                    ].map((card) => (
                      <div key={card.label} className="liquid-glass-sm p-3 md:p-4 text-center">
                        <div className="text-white/30 text-[10px] md:text-xs mb-1">{card.label}</div>
                        <div className="data-number text-sm md:text-xl font-medium" style={{ color: card.color }}>{card.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="liquid-glass p-4 md:p-6">
                  <h2 className="text-base md:text-lg font-medium text-white mb-1">累计投入、市值 vs 买入持有基准</h2>
                  <p className="text-white/35 text-xs mb-4">蓝色为定投累计投入，绿色为定投市值，黄色为同等总资金在期初一次性买入后的市值。</p>
                  <div className="h-72 md:h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={result.monthlyData || []} margin={{ top: 24, right: 18, left: 4, bottom: 0 }}>
                        <defs>
                          <linearGradient id="investedGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={ACCENT_PRIMARY} stopOpacity={0.18} />
                            <stop offset="100%" stopColor={ACCENT_PRIMARY} stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="valueGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={UP_COLOR} stopOpacity={0.22} />
                            <stop offset="100%" stopColor={UP_COLOR} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 10 }} tickFormatter={(v) => v?.slice(0, 7) || ""} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} />
                        <YAxis
                          tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                          width={66}
                          domain={[
                            (dataMin: number) => {
                              const min = Number.isFinite(dataMin) ? dataMin : 0;
                              const pad = Math.max(Math.abs(min) * 0.18, 1000);
                              return Math.floor(Math.min(0, min - pad));
                            },
                            (dataMax: number) => {
                              const max = Number.isFinite(dataMax) ? dataMax : 0;
                              const pad = Math.max(Math.abs(max) * 0.24, 2000);
                              return Math.ceil(max + pad);
                            },
                          ]}
                          allowDataOverflow={false}
                          tickFormatter={(v) => `¥${(v / 10000).toFixed(1)}万`}
                        />
                        <Tooltip
                          contentStyle={{ background: "rgba(5, 8, 26, 0.96)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", fontSize: "12px" }}
                          labelStyle={{ color: "rgba(255,255,255,0.45)" }}
                          formatter={(v: any, n: string) => {
                            const label = n === "invested" ? "定投累计投入" : n === "value" ? "定投市值" : "买入持有基准";
                            return [money(v), label];
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: "11px", color: "rgba(255,255,255,0.55)" }} />
                        <Area type="monotone" dataKey="invested" name="定投累计投入" stroke={ACCENT_PRIMARY} strokeWidth={1.5} fill="url(#investedGrad)" />
                        <Area type="monotone" dataKey="value" name="定投市值" stroke={UP_COLOR} strokeWidth={2} fill="url(#valueGrad)" />
                        <Area type="monotone" dataKey="benchmark" name="买入持有基准" stroke="#FFD166" strokeWidth={2} fill="transparent" connectNulls />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {Array.isArray(result.strategyResults) && result.strategyResults.length > 0 && (
                  <div className="liquid-glass p-4 md:p-6">
                    <h2 className="text-base md:text-lg font-medium text-white mb-4">多策略横向比较</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {result.strategyResults.map((item: any) => (
                        <div key={item.key} className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-white/85 text-sm font-medium">{strategyLabels[item.key] || item.key}</span>
                            <span className={`data-number text-sm ${getChangeTextClass(toNum(item.totalReturn))}`}>{toNum(item.totalReturn) >= 0 ? "+" : ""}{toNum(item.totalReturn).toFixed(2)}%</span>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-[11px]">
                            <div><div className="text-white/30">年化</div><div className="data-number text-white/70">{toNum(item.annualizedReturn).toFixed(2)}%</div></div>
                            <div><div className="text-white/30">回撤</div><div className="data-number" style={{ color: RISK_COLOR }}>{toNum(item.maxDrawdown).toFixed(2)}%</div></div>
                            <div><div className="text-white/30">夏普</div><div className="data-number" style={{ color: POSITIVE_METRIC_COLOR }}>{toNum(item.sharpeRatio).toFixed(2)}</div></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="liquid-glass p-4 md:p-6">
                  <h2 className="text-base md:text-lg font-medium text-white mb-4">定投策略 vs 一次性买入</h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-4">
                    {[
                      { label: "定投总收益", value: `${totalReturnNum >= 0 ? "+" : ""}${totalReturnNum.toFixed(2)}%`, color: totalReturnNum >= 0 ? UP_COLOR : DOWN_COLOR },
                      { label: "买入持有收益", value: `${benchmarkReturnNum >= 0 ? "+" : ""}${benchmarkReturnNum.toFixed(2)}%`, color: benchmarkReturnNum >= 0 ? UP_COLOR : DOWN_COLOR },
                      { label: "定投超额", value: `${excessNum >= 0 ? "+" : ""}${excessNum.toFixed(2)}%`, color: excessNum >= 0 ? UP_COLOR : DOWN_COLOR },
                      { label: "买入持有最大回撤", value: `${toNum(result.benchmark?.maxDrawdown).toFixed(2)}%`, color: RISK_COLOR },
                    ].map((item) => (
                      <div key={item.label} className="liquid-glass-sm p-3 text-center">
                        <div className="text-white/30 text-[10px] md:text-xs mb-1">{item.label}</div>
                        <div className="data-number text-sm md:text-base font-medium" style={{ color: item.color }}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-3">
                      <div className="text-white/35 text-xs mb-1 flex items-center gap-1"><Info className="w-3 h-3" />基准回撤</div>
                      <div className="text-white/65 text-xs leading-relaxed">指一次性买入后的市值曲线从阶段高点到低点的最大跌幅，用来衡量满仓持有承受的最大账面压力。</div>
                    </div>
                    <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-3">
                      <div className="text-white/35 text-xs mb-1">资金口径</div>
                      <div className="text-white/65 text-xs leading-relaxed">定投是分批投入；基准为了公平比较，使用同等累计投入金额在期初一次性买入。</div>
                    </div>
                    <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-3">
                      <div className="text-white/35 text-xs mb-1">长期解读</div>
                      <div className="text-white/65 text-xs leading-relaxed">上涨趋势中一次性买入常领先；震荡或下跌后修复阶段，定投更关注成本摊薄和回撤体验。</div>
                    </div>
                  </div>
                </div>

                <div className="liquid-glass p-4 md:p-6">
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                    <h2 className="text-base md:text-lg font-medium text-white flex items-center gap-2">
                      <Sparkles className="w-5 h-5" style={{ color: ACCENT_INFO }} />AI 定投策略评价
                    </h2>
                    <button onClick={handleLLMReview} disabled={llmLoading}
                      className="h-9 px-4 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                      style={{ background: `${ACCENT_INFO}1A`, color: ACCENT_INFO, border: `1px solid ${ACCENT_INFO}40` }}>
                      {llmLoading ? "AI 评价生成中..." : llmReview ? "重新生成评价" : "生成 AI 专业评价"}
                    </button>
                  </div>
                  {llmLoading && (
                    <div className="flex items-center gap-2 text-white/40 text-sm py-6">
                      <Loader2 className="w-4 h-4 animate-spin" />DeepSeek v4 flash 正在分析定投表现...
                    </div>
                  )}
                  {!llmLoading && !llmReview && (
                    <p className="text-white/40 text-sm">点击上方按钮调用 DeepSeek v4 flash，对当前回测策略生成专业评价。</p>
                  )}
                  {!llmLoading && llmReview && (
                    <div className="space-y-3">
                      {llmReview.verdict && (
                        <div className="liquid-glass-sm p-3">
                          <div className="text-xs mb-1" style={{ color: ACCENT_INFO }}>综合评级</div>
                          <div className="text-white text-sm font-medium">{llmReview.verdict}</div>
                        </div>
                      )}
                      {llmReview.analysis && (
                        <div className="liquid-glass-sm p-3">
                          <div className="text-xs mb-1" style={{ color: ACCENT_INFO }}>专业分析</div>
                          <div className="text-white/70 text-sm leading-relaxed whitespace-pre-wrap">{llmReview.analysis}</div>
                        </div>
                      )}
                      {Array.isArray(llmReview.suggestions) && llmReview.suggestions.length > 0 && (
                        <div className="liquid-glass-sm p-3">
                          <div className="text-xs mb-2" style={{ color: ACCENT_HIGHLIGHT }}>优化建议</div>
                          <ul className="space-y-1.5">
                            {llmReview.suggestions.map((item: string, i: number) => (
                              <li key={i} className="text-white/70 text-sm flex gap-2"><span className="text-white/30">{i + 1}.</span><span>{item}</span></li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {Array.isArray(llmReview.risk_notes) && llmReview.risk_notes.length > 0 && (
                        <div className="liquid-glass-sm p-3">
                          <div className="text-xs mb-2" style={{ color: RISK_COLOR }}>风险提示</div>
                          <ul className="space-y-1.5">
                            {llmReview.risk_notes.map((item: string, i: number) => (
                              <li key={i} className="text-white/70 text-sm flex gap-2"><span className="text-white/30">{i + 1}.</span><span>{item}</span></li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {llmReview.raw && <p className="text-white/60 text-sm leading-relaxed whitespace-pre-wrap">{llmReview.raw}</p>}
                    </div>
                  )}
                </div>

                <button onClick={() => { setResult(null); setLlmReview(null); }} className="flex items-center gap-2 text-white/35 hover:text-white/65 text-sm transition-colors">
                  <RotateCcw className="w-4 h-4" />重新配置
                </button>
              </div>
            ) : (
              <div className="liquid-glass p-8 md:p-12 flex flex-col items-center justify-center text-center min-h-[420px] md:min-h-[560px]">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#3B6CFF]/20 to-[#5AA9FF]/10 flex items-center justify-center mb-4">
                  <Calculator className="w-10 h-10 text-[#3B6CFF]/50" />
                </div>
                <h3 className="text-xl font-medium text-white/65 mb-2">配置你的定投策略</h3>
                <p className="text-white/35 text-sm max-w-md">
                  选择基金、策略、频率和日期后，可查看定投现金流收益、最大回撤、夏普，以及与一次性买入的同资金对比。
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
