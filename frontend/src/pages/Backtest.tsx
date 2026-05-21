import { useMemo, useState } from "react";
import { Calculator, Play, RotateCcw, Loader2, AlertCircle, Sparkles, Search, Plus, X } from "lucide-react";
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

const strategies = [
  { value: "fixed_amount", label: "固定金额定投", desc: "每期投入固定金额，适合收入稳定的投资者" },
  { value: "fixed_ratio", label: "固定比例定投", desc: "按总资产比例定投，适合资产规模较大的投资者" },
  { value: "value_averaging", label: "价值平均定投", desc: "根据目标市值调整投入，低点多投高点少投" },
  { value: "smart_beta", label: "智能Beta定投", desc: "基于市场估值水平动态调整定投金额" },
  { value: "martingale", label: "马丁格尔定投", desc: "下跌时加倍投入，快速摊薄成本" },
];

const frequencies = [
  { value: "weekly", label: "每周" },
  { value: "biweekly", label: "双周" },
  { value: "monthly", label: "每月" },
];

export default function Backtest() {
  const { data: listData } = trpc.fund.list.useQuery({ pageSize: 1000 });
  const { data: backtestListData } = trpc.fund.backtests.useQuery();
  const allFunds = listData?.funds ?? [];
  const backtestList = backtestListData ?? [];

  const [selectedFunds, setSelectedFunds] = useState<number[]>([]);
  const [weights, setWeights] = useState<number[]>([]);
  const [strategy, setStrategy] = useState("fixed_amount");
  const [frequency, setFrequency] = useState("monthly");
  const [amount, setAmount] = useState("1000");
  const [startDate, setStartDate] = useState("2023-01-01");
  const [endDate, setEndDate] = useState("2025-05-15");
  const [result, setResult] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [llmReview, setLlmReview] = useState<any>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [fundSearch, setFundSearch] = useState("");

  const utils = trpc.useUtils();
  const llmMutation = trpc.fund.analyzeDcaLLM.useMutation();

  const handleAddFund = (fundId: number) => {
    if (!selectedFunds.includes(fundId)) {
      const newFunds = [...selectedFunds, fundId];
      setSelectedFunds(newFunds);
      setWeights(newFunds.map(() => Math.floor(100 / newFunds.length)));
    }
  };

  const handleRemoveFund = (index: number) => {
    const newFunds = selectedFunds.filter((_, i) => i !== index);
    setSelectedFunds(newFunds);
    setWeights(newFunds.map(() => Math.floor(100 / newFunds.length)));
  };

  const handleRun = async () => {
    if (selectedFunds.length === 0) return;
    const investAmount = parseFloat(amount);
    if (!investAmount || investAmount <= 0) {
      setErrorMsg("单次投入金额必须大于0");
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
      let normalizedWeights = weights.length > 0
        ? weights
        : selectedFunds.map(() => Math.floor(100 / selectedFunds.length));
      const totalW = normalizedWeights.reduce((a, b) => a + b, 0);
      if (totalW !== 100 && totalW > 0) {
        normalizedWeights = normalizedWeights.map((w) => Math.round((w / totalW) * 100));
        const diff = 100 - normalizedWeights.reduce((a, b) => a + b, 0);
        if (diff !== 0) normalizedWeights[0] += diff;
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
      if (data) {
        setResult(data);
      }
    } catch (err: any) {
      const msg = err?.message || "回测计算失败，请检查参数后重试";
      console.error("回测失败:", err);
      setErrorMsg(msg);
    } finally {
      setIsRunning(false);
    }
  };

  const handleLLMReview = async () => {
    if (!result || llmLoading) return;
    setLlmLoading(true);
    try {
      const code = result.fundCode || (allFunds.find((f: any) => f.id === selectedFunds[0])?.fundCode ?? "");
      const name = result.fundName || (allFunds.find((f: any) => f.id === selectedFunds[0])?.fundAbbr ?? code);
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
          strategy,
          frequency,
        },
        benchmark: result.benchmark || {},
      });
      setLlmReview(review?.review ?? review);
    } catch (err) {
      console.error("LLM 评价失败:", err);
      setLlmReview({ raw: "AI 评价服务暂时不可用，请稍后重试。" });
    } finally {
      setLlmLoading(false);
    }
  };

  const selectedFundDetails = selectedFunds.map((id) => allFunds.find((f: any) => f.id === id)).filter(Boolean);
  const filteredFundOptions = useMemo(() => {
    const keyword = fundSearch.trim().toLowerCase();
    const source = keyword
      ? allFunds.filter((f: any) =>
          f.fundCode?.includes(keyword) ||
          f.fundName?.toLowerCase().includes(keyword) ||
          f.fundAbbr?.toLowerCase().includes(keyword) ||
          f.category?.toLowerCase().includes(keyword)
        )
      : allFunds;
    return source.filter((f: any) => !selectedFunds.includes(f.id)).slice(0, 24);
  }, [allFunds, fundSearch, selectedFunds]);
  const totalReturnNum = parseFloat(result?.totalReturn || "0");
  const benchmarkReturnNum = parseFloat(result?.benchmark?.totalReturn || result?.benchmarkReturn || "0");
  const excessNum = totalReturnNum - benchmarkReturnNum;

  return (
    <div className="min-h-screen pt-14 pb-12">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="pt-8 md:pt-12 pb-6 md:pb-8">
          <h1 className="text-2xl md:text-4xl font-semibold text-white tracking-tight" style={{ letterSpacing: "-1.2px" }}>智能定投与回测</h1>
          <p className="mt-2 text-white/40 text-sm md:text-base">通过历史数据验证定投策略的有效性，为您的投资决策提供量化支持</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          <div className="lg:col-span-1 space-y-4">
            <div className="liquid-glass p-4 md:p-5">
              <h2 className="text-base md:text-lg font-medium text-white mb-4 flex items-center gap-2">
                <Calculator className="w-5 h-5" style={{ color: ACCENT_PRIMARY }} />策略配置
              </h2>

              <div className="mb-4">
                <label className="text-xs text-white/40 mb-2 block">选择基金</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25" />
                  <input
                    value={fundSearch}
                    onChange={(e) => setFundSearch(e.target.value)}
                    placeholder="输入代码、名称或类型筛选产品"
                    className="w-full h-10 pl-9 pr-3 rounded-lg bg-[#0B1021] border border-white/[0.08] text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-[#3B6CFF]/50"
                  />
                </div>
                <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-white/[0.06] bg-[#070B18]/80">
                  {filteredFundOptions.map((f: any) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => { handleAddFund(f.id); setFundSearch(""); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.06] border-b border-white/[0.03] last:border-b-0 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5 text-[#5AA9FF] shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-white/85 text-sm truncate">{f.fundAbbr || f.fundName}</div>
                        <div className="text-white/35 text-xs data-number">{f.fundCode} · {f.category}</div>
                      </div>
                      <span className="text-[10px] text-white/35 px-1.5 py-0.5 rounded bg-white/[0.04]">{f.fundType}</span>
                    </button>
                  ))}
                  {filteredFundOptions.length === 0 && (
                    <div className="px-3 py-4 text-center text-white/35 text-sm">没有匹配产品</div>
                  )}
                </div>

                {selectedFundDetails.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {selectedFundDetails.map((f: any, i: number) => (
                      <div key={f.id} className="flex items-center gap-2 rounded-lg bg-white/[0.04] border border-white/[0.06] px-3 py-2">
                        <span className="text-white text-sm flex-1 truncate">{f.fundAbbr}</span>
                        {selectedFunds.length > 1 && (
                          <input type="number" value={weights[i] || 0}
                            onChange={(e) => { const newW = [...weights]; newW[i] = parseInt(e.target.value) || 0; setWeights(newW); }}
                            className="w-14 h-7 rounded bg-[#0B1021] border border-white/[0.08] text-white text-xs data-number text-center" />
                        )}
                        <button onClick={() => handleRemoveFund(i)} className="text-white/35 hover:text-[#F5384B] p-1" title="移除">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mb-4">
                <label className="text-xs text-white/40 mb-2 block">定投策略</label>
                <div className="space-y-1.5">
                  {strategies.map((s) => (
                    <button key={s.value} onClick={() => setStrategy(s.value)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all ${
                        strategy === s.value ? "bg-[#3B6CFF]/15 text-[#5AA9FF] border border-[#3B6CFF]/20" : "text-white/50 hover:text-white/70 hover:bg-white/[0.03] border border-transparent"
                      }`}>
                      <div className="font-medium">{s.label}</div>
                      <div className="text-[10px] text-white/30 mt-0.5">{s.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-xs text-white/40 mb-1 block">单次金额 (元)</label>
                  <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white text-sm data-number focus:outline-none focus:border-[#3B6CFF]/50" />
                </div>
                <div>
                  <label className="text-xs text-white/40 mb-1 block">定投频率</label>
                  <select value={frequency} onChange={(e) => setFrequency(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-[#0B1021] border border-white/[0.08] text-white text-sm focus:outline-none focus:border-[#3B6CFF]/50">
                    {frequencies.map((f) => (<option key={f.value} value={f.value} className="bg-[#0B1021] text-white">{f.label}</option>))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-xs text-white/40 mb-1 block">起始日期</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white text-sm focus:outline-none focus:border-[#3B6CFF]/50" />
                </div>
                <div>
                  <label className="text-xs text-white/40 mb-1 block">结束日期</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white text-sm focus:outline-none focus:border-[#3B6CFF]/50" />
                </div>
              </div>

              {errorMsg && (
                <div className="mb-3 flex items-start gap-2 text-xs" style={{ color: UP_COLOR }}>
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

            {backtestList.length > 0 && (
              <div className="liquid-glass p-5">
                <h2 className="text-sm font-medium text-white/40 mb-3">历史回测</h2>
                <div className="space-y-2">
                  {backtestList.map((bt: any) => {
                    const ret = parseFloat(bt.totalReturn || "0");
                    return (
                      <div key={bt.id} className="liquid-glass-sm p-3 hover:bg-white/[0.06] transition-all cursor-pointer">
                        <div className="text-white text-sm">{bt.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`data-number text-xs ${getChangeTextClass(ret)}`}>{ret >= 0 ? "+" : ""}{bt.totalReturn}%</span>
                          <span className="text-xs text-white/20">|</span>
                          <span className="text-xs text-white/30">{bt.strategy === "fixed_amount" ? "固定金额" : bt.strategy === "value_averaging" ? "价值平均" : bt.strategy === "smart_beta" ? "智能Beta" : "马丁格尔"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            {result ? (
              <div className="space-y-4 md:space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
                  {[
                    { label: "总投入", value: `¥${(parseFloat(result.totalInvested) || 0).toLocaleString()}`, color: ACCENT_PRIMARY },
                    { label: "最终价值", value: `¥${(parseFloat(result.finalValue) || 0).toLocaleString()}`, color: POSITIVE_METRIC_COLOR },
                    { label: "总收益率", value: `${totalReturnNum >= 0 ? "+" : ""}${result.totalReturn ?? 0}%`, color: totalReturnNum >= 0 ? UP_COLOR : DOWN_COLOR },
                    { label: "年化收益", value: `${result.annualizedReturn ?? 0}%`, color: parseFloat(result.annualizedReturn || "0") >= 0 ? UP_COLOR : DOWN_COLOR },
                    { label: "最大回撤", value: `${result.maxDrawdown ?? 0}%`, color: RISK_COLOR },
                    { label: "夏普比率", value: result.sharpeRatio ?? "—", color: POSITIVE_METRIC_COLOR },
                  ].map((card) => (
                    <div key={card.label} className="liquid-glass-sm p-3 md:p-4 text-center group hover:bg-white/[0.06] transition-all">
                      <div className="text-white/30 text-[10px] md:text-xs mb-1">{card.label}</div>
                      <div className="data-number text-sm md:text-xl font-medium" style={{ color: card.color }}>{card.value}</div>
                    </div>
                  ))}
                </div>

                <div className="liquid-glass p-4 md:p-6">
                  <h2 className="text-base md:text-lg font-medium text-white mb-4">累计收益走势 vs 买入持有基准</h2>
                  <div className="h-72 md:h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={result.monthlyData || []} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="investedGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={ACCENT_PRIMARY} stopOpacity={0.2} />
                            <stop offset="100%" stopColor={ACCENT_PRIMARY} stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="valueGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={UP_COLOR} stopOpacity={0.25} />
                            <stop offset="100%" stopColor={UP_COLOR} stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="benchmarkGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={ACCENT_HIGHLIGHT} stopOpacity={0.18} />
                            <stop offset="100%" stopColor={ACCENT_HIGHLIGHT} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} tickFormatter={(v) => v?.slice(0, 7) || ""} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} />
                        <YAxis
                          tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                          width={60}
                          domain={[
                            (dataMin: number) => {
                              const min = Number.isFinite(dataMin) ? dataMin : 0;
                              const padding = Math.max(Math.abs(min) * 0.08, 500);
                              return Math.floor(Math.min(0, min - padding));
                            },
                            (dataMax: number) => {
                              const max = Number.isFinite(dataMax) ? dataMax : 0;
                              const padding = Math.max(Math.abs(max) * 0.14, 1000);
                              return Math.ceil(max + padding);
                            },
                          ]}
                          allowDataOverflow={false}
                          tickFormatter={(v) => `¥${(v / 10000).toFixed(1)}万`}
                        />
                        <Tooltip contentStyle={{ background: "rgba(5, 8, 26, 0.95)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", fontSize: "12px" }}
                          labelStyle={{ color: "rgba(255,255,255,0.4)" }}
                          formatter={(v: any, n: string) => {
                            if (v === null || v === undefined) return ["—", n];
                            const label = n === "invested" ? "累计投入" : n === "value" ? "定投价值" : "买入持有";
                            return [`¥${parseFloat(v).toLocaleString()}`, label];
                          }} />
                        <Legend wrapperStyle={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }} />
                        <Area type="monotone" dataKey="invested" name="累计投入" stroke={ACCENT_PRIMARY} strokeWidth={1.5} fill="url(#investedGrad)" />
                        <Area type="monotone" dataKey="value" name="定投价值" stroke={UP_COLOR} strokeWidth={2} fill="url(#valueGrad)" />
                        <Area type="monotone" dataKey="benchmark" name="买入持有基准" stroke={ACCENT_HIGHLIGHT} strokeWidth={1.5} strokeDasharray="4 3" fill="url(#benchmarkGrad)" connectNulls />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="liquid-glass p-4 md:p-6">
                  <h2 className="text-base md:text-lg font-medium text-white mb-4">策略 vs 买入持有 对比</h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-4">
                    <div className="liquid-glass-sm p-3 text-center">
                      <div className="text-white/30 text-[10px] md:text-xs mb-1">定投总收益</div>
                      <div className={`data-number text-sm md:text-base font-medium ${getChangeTextClass(totalReturnNum)}`}>{totalReturnNum >= 0 ? "+" : ""}{result.totalReturn}%</div>
                    </div>
                    <div className="liquid-glass-sm p-3 text-center">
                      <div className="text-white/30 text-[10px] md:text-xs mb-1">买入持有</div>
                      <div className={`data-number text-sm md:text-base font-medium ${getChangeTextClass(benchmarkReturnNum)}`}>{benchmarkReturnNum >= 0 ? "+" : ""}{benchmarkReturnNum.toFixed(2)}%</div>
                    </div>
                    <div className="liquid-glass-sm p-3 text-center">
                      <div className="text-white/30 text-[10px] md:text-xs mb-1">超额收益</div>
                      <div className={`data-number text-sm md:text-base font-medium ${getChangeTextClass(excessNum)}`}>{excessNum >= 0 ? "+" : ""}{excessNum.toFixed(2)}%</div>
                    </div>
                    <div className="liquid-glass-sm p-3 text-center">
                      <div className="text-white/30 text-[10px] md:text-xs mb-1">基准回撤</div>
                      <div className="data-number text-sm md:text-base font-medium" style={{ color: RISK_COLOR }}>{result.benchmark?.maxDrawdown ?? "—"}%</div>
                    </div>
                  </div>
                  <p className="text-white/50 text-xs md:text-sm leading-relaxed">
                    {excessNum > 0
                      ? `定投策略相比一次性买入持有产生了 ${excessNum.toFixed(2)}% 的超额收益，在该时段的波动市场中体现出成本平摊优势。`
                      : excessNum < -2
                      ? `本时段为单边上行市，一次性买入持有领先定投 ${Math.abs(excessNum).toFixed(2)}%，建议在震荡或下跌市场中再考虑定投。`
                      : `定投与买入持有表现接近，差异 ${Math.abs(excessNum).toFixed(2)}%，可结合风险偏好选择。`}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-4">
                    <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-3">
                      <div className="text-white/35 text-xs mb-1">回测口径</div>
                      <div className="text-white/65 text-xs leading-relaxed">按实际可用净值日买入，周/双周/月频率取周期内首个交易日。</div>
                    </div>
                    <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-3">
                      <div className="text-white/35 text-xs mb-1">年化口径</div>
                      <div className="text-white/65 text-xs leading-relaxed">定投使用现金流年化收益，买入持有使用期初一次性投入比较。</div>
                    </div>
                    <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-3">
                      <div className="text-white/35 text-xs mb-1">风险指标</div>
                      <div className="text-white/65 text-xs leading-relaxed">最大回撤基于组合市值曲线，夏普由日度曲线收益估算。</div>
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
                      <Loader2 className="w-4 h-4 animate-spin" />DeepSeek 正在分析定投表现...
                    </div>
                  )}
                  {!llmLoading && !llmReview && (
                    <p className="text-white/40 text-sm">点击上方按钮调用 DeepSeek-V4 LLM 对当前回测策略生成专业评价。</p>
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
                            {llmReview.suggestions.map((s: string, i: number) => (
                              <li key={i} className="text-white/70 text-sm flex gap-2">
                                <span className="text-white/30">{i + 1}.</span><span>{s}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {Array.isArray(llmReview.risk_notes) && llmReview.risk_notes.length > 0 && (
                        <div className="liquid-glass-sm p-3">
                          <div className="text-xs mb-2" style={{ color: RISK_COLOR }}>风险提示</div>
                          <ul className="space-y-1.5">
                            {llmReview.risk_notes.map((s: string, i: number) => (
                              <li key={i} className="text-white/70 text-sm flex gap-2">
                                <span className="text-white/30">{i + 1}.</span><span>{s}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {llmReview.raw && (
                        <p className="text-white/60 text-sm leading-relaxed whitespace-pre-wrap">{llmReview.raw}</p>
                      )}
                    </div>
                  )}
                </div>

                <button onClick={() => { setResult(null); setLlmReview(null); }} className="flex items-center gap-2 text-white/30 hover:text-white/60 text-sm transition-colors">
                  <RotateCcw className="w-4 h-4" />重新配置
                </button>
              </div>
            ) : (
              <div className="liquid-glass p-8 md:p-12 flex flex-col items-center justify-center text-center min-h-[400px] md:min-h-[500px]">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#3B6CFF]/20 to-[#5AA9FF]/10 flex items-center justify-center mb-4">
                  <Calculator className="w-10 h-10 text-[#3B6CFF]/50" />
                </div>
                <h3 className="text-xl font-medium text-white/60 mb-2">配置您的定投策略</h3>
                <p className="text-white/30 text-sm max-w-md">
                  选择基金产品、设定定投参数，我们将基于历史数据为您计算策略的回测表现，并提供 AI 专业评价
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
