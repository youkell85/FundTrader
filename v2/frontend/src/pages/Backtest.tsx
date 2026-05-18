import { useState, useMemo } from "react";
import { Calculator, Play, RotateCcw, Loader2, AlertCircle } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { trpc } from "@/providers/trpc";

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
  const { data: listData, isLoading: listLoading } = trpc.fund.list.useQuery({ pageSize: 1000 });
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

  const utils = trpc.useUtils();

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
    try {
      let normalizedWeights = weights.length > 0
        ? weights
        : selectedFunds.map(() => Math.floor(100 / selectedFunds.length));
      // 自动归一化权重使其总和为100
      const totalW = normalizedWeights.reduce((a, b) => a + b, 0);
      if (totalW !== 100 && totalW > 0) {
        normalizedWeights = normalizedWeights.map((w) => Math.round((w / totalW) * 100));
        // 修正舍入误差
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

  const selectedFundDetails = selectedFunds.map((id) => allFunds.find((f: any) => f.id === id)).filter(Boolean);

  return (
    <div className="min-h-screen pt-14 pb-12">
      <div className="max-w-7xl mx-auto px-6">
        <div className="pt-12 pb-8">
          <h1 className="text-4xl font-semibold text-white tracking-tight" style={{ letterSpacing: "-1.2px" }}>智能定投与回测</h1>
          <p className="mt-2 text-white/40 text-base">通过历史数据验证定投策略的有效性，为您的投资决策提供量化支持</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-4">
            <div className="liquid-glass p-5">
              <h2 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                <Calculator className="w-5 h-5 text-[#00F0FF]" />策略配置
              </h2>

              <div className="mb-4">
                <label className="text-xs text-white/40 mb-2 block">选择基金</label>
                <select className="w-full h-10 px-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white/70 text-sm focus:outline-none focus:border-[#3B6CFF]/50"
                  onChange={(e) => { if (e.target.value) { handleAddFund(parseInt(e.target.value)); e.target.value = ""; } }} value="">
                  <option value="">+ 添加基金</option>
                  {allFunds.map((f: any) => (<option key={f.id} value={f.id}>{f.fundAbbr || f.fundName} ({f.fundCode})</option>))}
                </select>

                {selectedFundDetails.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {selectedFundDetails.map((f: any, i: number) => (
                      <div key={f.id} className="flex items-center gap-2 liquid-glass-sm px-3 py-2">
                        <span className="text-white text-sm flex-1 truncate">{f.fundAbbr}</span>
                        {selectedFunds.length > 1 && (
                          <input type="number" value={weights[i] || 0}
                            onChange={(e) => { const newW = [...weights]; newW[i] = parseInt(e.target.value) || 0; setWeights(newW); }}
                            className="w-14 h-6 rounded bg-white/[0.05] border border-white/[0.06] text-white/60 text-xs data-number text-center" />
                        )}
                        <button onClick={() => handleRemoveFund(i)} className="text-white/20 hover:text-[#FF3366] text-xs">x</button>
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
                        strategy === s.value ? "bg-[#3B6CFF]/15 text-[#00F0FF] border border-[#3B6CFF]/20" : "text-white/50 hover:text-white/70 hover:bg-white/[0.03] border border-transparent"
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
                    className="w-full h-10 px-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white/70 text-sm focus:outline-none focus:border-[#3B6CFF]/50">
                    {frequencies.map((f) => (<option key={f.value} value={f.value}>{f.label}</option>))}
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
                <div className="mb-3 flex items-start gap-2 text-xs text-[#FF3366]">
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
                  {backtestList.map((bt: any) => (
                    <div key={bt.id} className="liquid-glass-sm p-3 hover:bg-white/[0.06] transition-all cursor-pointer">
                      <div className="text-white text-sm">{bt.name}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="data-number text-xs text-[#00F0FF]">+{bt.totalReturn}%</span>
                        <span className="text-xs text-white/20">|</span>
                        <span className="text-xs text-white/30">{bt.strategy === "fixed_amount" ? "固定金额" : bt.strategy === "value_averaging" ? "价值平均" : bt.strategy === "smart_beta" ? "智能Beta" : "马丁格尔"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            {result ? (
              <div className="space-y-6">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "总投入", value: `¥${(parseFloat(result.totalInvested) || 0).toLocaleString()}`, color: "#3B6CFF" },
                    { label: "最终价值", value: `¥${(parseFloat(result.finalValue) || 0).toLocaleString()}`, color: "#00F0FF" },
                    { label: "总收益率", value: `${parseFloat(result.totalReturn) >= 0 ? "+" : ""}${result.totalReturn ?? 0}%`, color: "#A3FF12" },
                    { label: "年化收益", value: `${result.annualizedReturn ?? 0}%`, color: "#FFB800" },
                    { label: "最大回撤", value: `${result.maxDrawdown ?? 0}%`, color: "#FF3366" },
                    { label: "夏普比率", value: result.sharpeRatio ?? "—", color: "#A3FF12" },
                  ].map((card) => (
                    <div key={card.label} className="liquid-glass-sm p-4 text-center group hover:bg-white/[0.06] transition-all">
                      <div className="text-white/30 text-xs mb-1">{card.label}</div>
                      <div className="data-number text-xl font-medium" style={{ color: card.color }}>{card.value}</div>
                    </div>
                  ))}
                </div>

                <div className="liquid-glass p-6">
                  <h2 className="text-lg font-medium text-white mb-4">累计收益走势</h2>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={result.monthlyData || []}>
                        <defs>
                          <linearGradient id="investedGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3B6CFF" stopOpacity={0.2} />
                            <stop offset="100%" stopColor="#3B6CFF" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="valueGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#00F0FF" stopOpacity={0.2} />
                            <stop offset="100%" stopColor="#00F0FF" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 11 }} tickFormatter={(v) => v?.slice(0, 7) || ""} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} />
                        <YAxis tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 11 }} axisLine={false} tickLine={false} width={65} tickFormatter={(v) => `¥${(v / 10000).toFixed(1)}万`} />
                        <Tooltip contentStyle={{ background: "rgba(5, 8, 26, 0.95)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", fontSize: "12px" }}
                          labelStyle={{ color: "rgba(255,255,255,0.4)" }} itemStyle={{ color: "#00F0FF" }}
                          formatter={(v: any, n: string) => [`¥${parseFloat(v).toLocaleString()}`, n === "invested" ? "累计投入" : "持仓价值"]} />
                        <Legend wrapperStyle={{ fontSize: "12px", color: "rgba(255,255,255,0.4)" }} />
                        <Area type="monotone" dataKey="invested" name="累计投入" stroke="#3B6CFF" strokeWidth={1.5} fill="url(#investedGrad)" />
                        <Area type="monotone" dataKey="value" name="持仓价值" stroke="#00F0FF" strokeWidth={1.5} fill="url(#valueGrad)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="liquid-glass p-6">
                  <h2 className="text-lg font-medium text-white mb-4">策略分析</h2>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <h3 className="text-sm text-white/40">回测表现</h3>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between"><span className="text-white/30">超额收益</span><span className="data-number text-[#00F0FF]">{parseFloat(result.excessReturn) >= 0 ? "+" : ""}{result.excessReturn ?? 0}%</span></div>
                        <div className="flex justify-between"><span className="text-white/30">基准收益</span><span className="data-number text-white/50">{result.benchmarkReturn ?? 0}%</span></div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <h3 className="text-sm text-white/40">策略建议</h3>
                      <p className="text-white/50 text-sm leading-relaxed">
                        {parseFloat(result.sharpeRatio || 0) > 0.8 ? "该策略风险调整后收益表现优秀，建议作为核心配置策略。"
                          : parseFloat(result.sharpeRatio || 0) > 0.5 ? "该策略具备合理的风险收益比，适合作为中长期定投方案。"
                            : "该策略在当前回测区间表现一般，建议调整基金选择或定投参数。"}
                      </p>
                    </div>
                  </div>
                </div>

                <button onClick={() => setResult(null)} className="flex items-center gap-2 text-white/30 hover:text-white/60 text-sm transition-colors">
                  <RotateCcw className="w-4 h-4" />重新配置
                </button>
              </div>
            ) : (
              <div className="liquid-glass p-12 flex flex-col items-center justify-center text-center min-h-[500px]">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#3B6CFF]/20 to-[#00F0FF]/10 flex items-center justify-center mb-4">
                  <Calculator className="w-10 h-10 text-[#3B6CFF]/50" />
                </div>
                <h3 className="text-xl font-medium text-white/60 mb-2">配置您的定投策略</h3>
                <p className="text-white/30 text-sm max-w-md">
                  选择基金产品、设定定投参数，我们将基于历史数据为您计算策略的回测表现
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
