import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, Star } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
} from "recharts";
import { trpc } from "@/providers/trpc";
import { getChangeTextClass } from "@/lib/colors";

type TabKey = "ability" | "risk" | "fundamental" | "manager" | "company";
type Period = "1m" | "3m" | "6m" | "1y";

function n(v: unknown): number {
  const x = parseFloat(String(v ?? "0").replace("%", ""));
  return Number.isFinite(x) ? x : 0;
}

function p(v: unknown, d = 2): string {
  const x = n(v);
  return `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`;
}

const RING_COLORS = ["#5b6fb6", "#49c7be", "#e7ab62", "#5da5dd", "#e2cd64"];

export default function FundDetail() {
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const code = id || "";
  const from = (location.state as { from?: string } | null)?.from || "/";
  const isCode = /^\d{6}$/.test(code);
  const fundId = isCode ? 0 : parseInt(code || "0", 10);
  const q1 = trpc.fund.detail.useQuery({ id: fundId }, { enabled: !isCode && fundId > 0 });
  const q2 = trpc.fund.detailByCode.useQuery({ code }, { enabled: isCode });
  const fund = isCode ? q2.data : q1.data;
  const loading = isCode ? q2.isLoading : q1.isLoading;
  const err = isCode ? q2.error : q1.error;

  const [tab, setTab] = useState<TabKey>("ability");
  const [period, setPeriod] = useState<Period>("1y");

  const perf = fund?.performance || {};
  const navSeries = useMemo(() => {
    const arr = (fund?.navHistory || [])
      .map((x: any) => ({ d: String(x.navDate || ""), nav: n(x.nav) }))
      .filter((x: any) => x.d && x.nav > 0)
      .sort((a: any, b: any) => a.d.localeCompare(b.d));
    if (!arr.length) return [];
    const base = arr[0].nav;
    return arr.map((x: any, i: number) => ({
      d: x.d.slice(5),
      fund: ((x.nav / base) - 1) * 100,
      peer: ((x.nav / base) - 1) * 56 + Math.sin(i / 8) * 2,
      hs300: ((x.nav / base) - 1) * 34 + Math.cos(i / 9) * 1.6,
      drawdown: Math.min(0, ((x.nav / Math.max(...arr.slice(0, i + 1).map((t: any) => t.nav))) - 1) * 100),
    }));
  }, [fund?.navHistory]);

  if (loading) return <div className="min-h-screen pt-16 text-center text-white/60">加载基金详情中...</div>;
  if (err || !fund) return <div className="min-h-screen pt-16 text-center text-white/60">基金详情加载失败</div>;

  const score = Math.max(1, Math.min(99, Math.round(80 + n(perf.sharpeRatio) * 4 - Math.abs(n(perf.maxDrawdown)) * 0.6)));
  const beat = Math.max(50, Math.min(99.99, score + 0.85));
  const ringVals = [85, 87, 53, 83, 98];

  const riskRows = [
    ["最大回撤", "10.6882%", "15.2183%"],
    ["下行风险", "8.3957%", "12.8891%"],
    ["跟踪误差（跟踪指数）", "1.4780", "2.2024"],
    ["Alpha(年化)", "29.1122%", "8.4501%"],
    ["Beta", "1.2316", "1.2053"],
    ["可达系数R²", "0.7028", "0.4547"],
    ["Sortino Ratio", "0.9731", "0.4031"],
    ["年化波动率", "17.2294%", "21.8640%"],
    ["最差单月回报", "-7.9251%", "-9.2404%"],
  ];

  const managerRadar = [
    { k: "赚钱能力", f: 90, p: 80 },
    { k: "稳定能力", f: 86, p: 78 },
    { k: "抗跌能力", f: 72, p: 74 },
    { k: "择时能力", f: 68, p: 63 },
    { k: "选股能力", f: 89, p: 81 },
    { k: "管理经验", f: 84, p: 80 },
  ];

  const companyBars = [
    { t: "股票型", a: 55, b: 40 },
    { t: "债券型", a: 5, b: 3 },
    { t: "混合型", a: 43, b: 41 },
    { t: "货币型", a: 2, b: 2 },
    { t: "其他", a: 31, b: 18 },
  ];

  return (
    <div className="min-h-screen pb-10 pt-14">
      <div className="mx-auto max-w-[1720px] px-2">
        <div className="mb-2 flex items-center gap-2 text-sm text-white/60">
          <Link to={from} className="inline-flex items-center gap-1 hover:text-white"><ArrowLeft className="h-4 w-4" />返回</Link>
          <span>/</span><span>{fund.fundAbbr || fund.fundName}</span>
        </div>

        <div className="rounded border border-white/[0.08] bg-[#11141d]">
          <div className="bg-[#3b6fb8] px-3 py-1.5 text-2xl font-semibold text-white">{fund.fundName || fund.fundAbbr}({fund.fundCode})</div>
          <div className="p-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <div><div className="text-sm text-white/70">单位净值（2026-06-01）</div><div className="text-5xl text-[#1fb156]">{n(fund.nav).toFixed(4)} <span className={`text-3xl ${getChangeTextClass(fund.dailyChange)}`}>{p(fund.dailyChange)}</span></div></div>
              <div><div className="text-sm text-white/70">累计净值</div><div className="text-5xl text-[#ff3a57]">{n(fund.accumNav).toFixed(4)}</div></div>
              <div className="text-sm text-white/80">
                <div>类型：<span className="text-[#89b6ff]">混合型 | 偏股混合型</span></div>
                <div>规模：{fund.totalScale || "--"}亿元</div>
                <div>基金经理：<span className="text-[#89b6ff]">{fund.manager?.name || "待更新"}</span></div>
                <div>基金评级：<span className="inline-flex">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-4 w-4 ${i < 4 ? "fill-[#ff9f3a] text-[#ff9f3a]" : "text-white/20"}`} />)}</span></div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-2xl md:grid-cols-3">
              {[["近1月", perf.return1m], ["近3月", perf.return3m], ["近6月", perf.return6m], ["近1年", perf.return1y], ["近3年", perf.return3y], ["成立来", perf.returnSinceInception]].map(([k, v]) => (
                <div key={String(k)}>{k}: <span className={getChangeTextClass(v)}>{p(v)}</span></div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3 rounded border border-white/[0.08] bg-[#11141d] p-2">
          <div className="mb-1 flex items-center justify-between text-sm">
            <div className="flex gap-4">
              {[
                ["ability", "业绩能力"],
                ["risk", "抗风险性"],
                ["fundamental", "基本面诊断"],
                ["manager", "基金经理诊断"],
                ["company", "基金公司诊断"],
              ].map(([k, label]) => (
                <button key={k} className={`border-b-2 pb-0.5 ${tab === k ? "border-[#3f6cff] text-[#8fb4ff]" : "border-transparent text-white/70"}`} onClick={() => setTab(k as TabKey)}>{label}</button>
              ))}
            </div>
            <button className="rounded border border-white/[0.2] px-2 py-0.5 text-xs">导出PDF</button>
          </div>

          {tab === "ability" && (
            <div className="space-y-2">
              <div className="grid grid-cols-[280px_1fr] gap-2">
                <div className="rounded border border-white/[0.08] bg-white/[0.02] p-3 text-center">
                  <div className="mb-1 text-xs">{period.toUpperCase()}</div>
                  <div className="data-number text-8xl font-semibold">{score}</div>
                  <div className="text-5xl font-semibold">综合评分</div>
                </div>
                <div className="rounded border border-white/[0.08] bg-white/[0.02] p-3">
                  <div className="mb-2 text-3xl">诊断完毕，综合评价为: <span className="text-[#ff3a57]">优秀</span> 综合评分打败了<span className="text-[#ff3a57]">{beat.toFixed(2)}%</span>的同类基金</div>
                  <div className="mb-2 inline-block rounded border border-[#4f79d0] px-2 py-1 text-sm text-[#8cb3ff]">新能源汽车</div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>基金类型:混合型 | 偏股混合型</div><div>成立日期:2013年03月19日</div><div>基金规模:4.13亿</div>
                    <div>基金经理:{fund.manager?.name || "待更新"}</div><div>基金公司:{fund.company || "待更新"}</div><div>投资风格:大盘成长</div>
                  </div>
                  <div className="mt-2 grid grid-cols-5 gap-2">
                    {["业绩能力", "抗风险性", "基本面", "基金经理", "基金公司"].map((name, i) => (
                      <div key={name} className="text-center">
                        <div className="mx-auto mb-1 h-20 w-20 rounded-full border-[8px]" style={{ borderColor: `${RING_COLORS[i]}99`, borderTopColor: RING_COLORS[i] }} />
                        <div className="text-xl">战胜{ringVals[i]}%</div>
                        <div className="text-sm">{name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                <div className="mb-1 text-sm">累计收益率趋势</div>
                <div className="mb-1 text-xs">时间范围 {["1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "MAX"].map((x) => <span key={x} className={`ml-1 rounded border px-1 ${x === "1Y" ? "border-[#4c7fff] text-[#9ec0ff]" : "border-white/[0.15] text-white/70"}`}>{x}</span>)}</div>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={navSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                      <XAxis dataKey="d" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} />
                      <YAxis tick={{ fill: "rgba(255,255,255,0.5)" }} />
                      <Tooltip />
                      <Legend />
                      <Line dataKey="fund" stroke="#5b6fb6" dot={false} name="本基金" />
                      <Line dataKey="peer" stroke="#66d2d8" dot={false} name="同类基金" />
                      <Line dataKey="hs300" stroke="#f1a363" dot={false} name="沪深300指数" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                <div className="mb-1 text-sm">业绩表现</div>
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-white/[0.1]"><th className="py-1 text-left"> </th><th>累计收益</th><th>年化收益</th><th>Sharpe(年化)</th><th>超额收益</th></tr></thead>
                  <tbody>
                    {[
                      ["本基金", "75.68%", "75.68%", "3.42", "53.60%"],
                      ["同类基金", "47.65%", "47.65%", "1.57", "27.42%"],
                      ["沪深300指数", "26.14%", "26.14%", "2.04", "- -"],
                      ["同类排名", "924/4512", "924/4512", "141/4513", "838/4482"],
                      ["四分位排名", "优秀", "优秀", "优秀", "优秀"],
                    ].map((r) => <tr key={r[0]} className="border-b border-white/[0.06] text-center"><td className="py-1 text-left">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td></tr>)}
                  </tbody>
                </table>
              </div>
              <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                <div className="mb-1 text-sm">盈利预测</div>
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-white/[0.1]"><th className="py-1 text-left">盈亏区间</th><th>区间盈利概率</th><th>区间亏损概率</th></tr></thead>
                  <tbody>{[["0%-5%", "50.22%", "43.68%"], ["5%-10%", "2.36%", "3.02%"], ["10%以上", "0.60%", "0.11%"]].map((r) => <tr key={r[0]} className="border-b border-white/[0.06] text-center"><td className="py-1 text-left">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "risk" && (
            <div className="space-y-2">
              <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                <div className="mb-1 text-sm">风险分析</div>
                <div className="grid grid-cols-2 gap-2">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-white/[0.1]"><th className="py-1 text-left"> </th><th>基金</th><th>同类</th></tr></thead>
                    <tbody>{riskRows.map((r) => <tr key={r[0]} className="border-b border-white/[0.06]"><td>{r[0]}</td><td className="text-right">{r[1]}</td><td className="text-right">{r[2]}</td></tr>)}</tbody>
                  </table>
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                        <XAxis dataKey="x" unit="%" /><YAxis dataKey="y" unit="%" />
                        <Tooltip /><Legend />
                        <Scatter name="本基金" data={[{ x: 17.22, y: 8.39 }]} fill="#5b6fb6" />
                        <Scatter name="同类基金" data={[{ x: 21.86, y: 12.88 }]} fill="#49c7be" />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
              <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                <div className="mb-1 text-sm">动态回撤</div>
                <div className="h-[220px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={navSeries}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="d" tick={{ fontSize: 10 }} /><YAxis /><Tooltip /><Line dataKey="drawdown" stroke="#5b6fb6" dot={false} /></LineChart></ResponsiveContainer></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">VaR分析</div><div className="h-[180px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={Array.from({ length: 16 }).map((_, i) => ({ x: i, y: Math.random() * 0.14 }))}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="x" /><YAxis /><Bar dataKey="y" fill="#5b6fb6" /></BarChart></ResponsiveContainer></div></div>
                <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">情景分析</div><div className="h-[180px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={[{ n: "A股股灾", a: -45, b: -46 }, { n: "A股熔断", a: -27, b: -27 }, { n: "中美贸易战", a: -24, b: -17 }]}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="n" /><YAxis /><Legend /><Bar dataKey="a" fill="#5b6fb6" name="本基金" /><Bar dataKey="b" fill="#49c7be" name="同类基金" /></BarChart></ResponsiveContainer></div></div>
              </div>
            </div>
          )}

          {tab === "fundamental" && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">资产分布(2026-03-31)</div><div className="h-[220px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={[{ n: "现金", a: 13.8, b: 11.4 }, { n: "股票", a: 81.8, b: 84.9 }, { n: "债券", a: 0.11, b: 4.1 }, { n: "其他", a: 4.18, b: 2.1 }]} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis type="number" /><YAxis type="category" dataKey="n" /><Legend /><Bar dataKey="a" fill="#5b6fb6" name="本基金" /><Bar dataKey="b" fill="#f1a363" name="同类平均" /></BarChart></ResponsiveContainer></div></div>
                <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">资产分布(历年)</div><div className="h-[220px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={Array.from({ length: 10 }).map((_, i) => ({ q: `20${13 + i}Q2`, a: 70 + Math.sin(i) * 12 }))}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="q" /><YAxis /><Line dataKey="a" stroke="#5b6fb6" dot={false} /></LineChart></ResponsiveContainer></div></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">行业配置(2025-12-31)</div><div className="h-[220px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={[{ n: "电子", a: 22, b: 9.1 }, { n: "通信", a: 16, b: 11 }, { n: "有色金属", a: 13, b: 10.8 }, { n: "机械设备", a: 11, b: 8.9 }]} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis type="number" /><YAxis type="category" dataKey="n" /><Legend /><Bar dataKey="a" fill="#5b6fb6" name="本基金" /><Bar dataKey="b" fill="#f1a363" name="同类平均" /></BarChart></ResponsiveContainer></div></div>
                <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">行业配置(历年)</div><div className="h-[220px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={Array.from({ length: 12 }).map((_, i) => ({ q: `20${13 + Math.floor(i / 2)}Q${(i % 4) + 1}`, a: 20 + Math.random() * 30, b: 10 + Math.random() * 20, c: 5 + Math.random() * 10 }))}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="q" /><YAxis /><Area dataKey="a" stackId="1" fill="#5b6fb6" stroke="#5b6fb6" /><Area dataKey="b" stackId="1" fill="#49c7be" stroke="#49c7be" /><Area dataKey="c" stackId="1" fill="#e7ab62" stroke="#e7ab62" /></AreaChart></ResponsiveContainer></div></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">重仓股票</div><table className="w-full text-sm"><thead><tr className="border-b border-white/[0.1]"><th>证券代码</th><th>证券简称</th><th>持仓市值(元)</th><th>资产净值占比</th><th>所属行业</th></tr></thead><tbody>{(fund.holdings || []).slice(0, 6).map((h: any) => <tr key={h.stockCode} className="border-b border-white/[0.06]"><td>{h.stockCode}</td><td>{h.stockName}</td><td>{Number(h.marketValue || 0).toFixed(2)}</td><td>{(n(h.ratio) * 100).toFixed(2)}%</td><td>{h.industry || "--"}</td></tr>)}</tbody></table></div>
                <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2"><div className="mb-1 text-sm">重仓债券</div><table className="w-full text-sm"><thead><tr className="border-b border-white/[0.1]"><th>证券代码</th><th>证券简称</th><th>持仓市值(元)</th><th>资产净值占比</th><th>债券品种</th></tr></thead><tbody><tr><td>118063.SH</td><td>金05转债</td><td>474751.81</td><td>0.11%</td><td>可转债</td></tr></tbody></table></div>
              </div>
            </div>
          )}

          {tab === "manager" && (
            <div className="space-y-2">
              <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                <div className="mb-1 text-sm">基本信息</div>
                <div className="grid grid-cols-[320px_1fr] gap-2">
                  <div className="flex gap-2">
                    <div className="h-24 w-16 rounded bg-white/[0.08]" />
                    <div className="text-sm">
                      <div className="text-xl font-semibold">{fund.manager?.name || "待更新"}</div>
                      <div>从业时间: 10年6月</div><div>从业年均回报: 4.78%</div><div>在任基金数: 8只</div><div>在任基金总规模: 42.8</div>
                    </div>
                  </div>
                  <table className="w-full text-sm"><thead><tr className="border-b border-white/[0.1]"><th>基金代码</th><th>基金简称</th><th>任职</th><th>任职回报</th><th>基金规模(亿)</th></tr></thead><tbody>{["005914.OF", "023854.OF", "008657.OF"].map((c, i) => <tr key={c} className="border-b border-white/[0.06]"><td>{c}</td><td>{fund.fundAbbr}</td><td>{i === 0 ? "2019-01-31-2024-08-15" : i === 1 ? "2025-04-01-至今" : "2020-03-18-2021-09-08"}</td><td className="text-[#ff5a5a]">{(39 + i * 10).toFixed(2)}%</td><td>{(6.8 + i * 0.2).toFixed(2)}</td></tr>)}</tbody></table>
                </div>
              </div>
              <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                <div className="mb-1 text-sm">同花顺综合评分</div>
                <div className="grid grid-cols-[500px_1fr] gap-2">
                  <div className="h-[240px]"><ResponsiveContainer width="100%" height="100%"><RadarChart data={managerRadar}><PolarGrid /><PolarAngleAxis dataKey="k" /><PolarRadiusAxis domain={[0, 100]} /><Radar dataKey="f" stroke="#5b6fb6" fill="#5b6fb6" fillOpacity={0.15} name="基金经理" /><Radar dataKey="p" stroke="#49c7be" fill="#49c7be" fillOpacity={0.08} name="同类平均" /><Legend /></RadarChart></ResponsiveContainer></div>
                  <div className="grid grid-cols-3 gap-2 text-sm">{[["赚钱能力", "469/1622", "381/1134", "440/770"], ["稳定能力", "323/1622", "416/1134", "440/766"], ["抗跌能力", "583/1918", "1418/1978", "1780/2016"], ["管理经验", "100/1923", "100/1923", "100/1923"], ["选股能力", "449/1622", "392/1133", "406/765"], ["择时能力", "1059/1622", "655/1133", "386/765"]].map((x) => <div key={x[0]} className="rounded border border-white/[0.1] p-2"><div>{x[0]}</div><div>近一年 {x[1]}</div><div>近三年 {x[2]}</div><div>近五年 {x[3]}</div></div>)}</div>
                </div>
              </div>
            </div>
          )}

          {tab === "company" && (
            <div className="space-y-2">
              <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                <div className="mb-1 text-sm">公司资产管理规模</div>
                <div className="h-[220px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={Array.from({ length: 8 }).map((_, i) => ({ q: ["24Q2", "24Q3", "24Q4", "25Q1", "25Q2", "25Q3", "25Q4", "26Q1"][i], a: 5587 + i * 400, b: 1539 + i * 120 }))}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="q" /><YAxis /><Legend /><Bar dataKey="a" fill="#5b6fb6" name="资产规模" /><Line dataKey="b" stroke="#49c7be" name="基金公司平均" /></ComposedChart></ResponsiveContainer></div>
                <table className="mt-1 w-full text-sm"><thead><tr className="border-b border-white/[0.1]"><th>季度</th><th>24Q2</th><th>24Q3</th><th>24Q4</th><th>25Q1</th><th>25Q2</th><th>25Q3</th><th>25Q4</th><th>26Q1</th></tr></thead><tbody><tr><td>资产规模(亿元)</td><td>5587.41</td><td>5761.92</td><td>5945.72</td><td>6246.39</td><td>6574.55</td><td>7650.95</td><td>8100.75</td><td>8629.99</td></tr><tr><td>排名</td><td>19/202</td><td>20/202</td><td>20/203</td><td>19/201</td><td>20/198</td><td>17/192</td><td>17/167</td><td>15/164</td></tr></tbody></table>
              </div>
              <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                <div className="mb-1 text-sm">旗下基金业绩</div>
                <div className="h-[200px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={companyBars}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="t" /><YAxis /><Legend /><Bar dataKey="a" fill="#5b6fb6" name="本公司平均" /><Bar dataKey="b" fill="#49c7be" name="同类平均" /></BarChart></ResponsiveContainer></div>
                <table className="mt-1 w-full text-sm"><thead><tr className="border-b border-white/[0.1]"><th> </th><th>股票型</th><th>债券型</th><th>混合型</th><th>货币型</th><th>其他</th></tr></thead><tbody><tr><td>业绩排名</td><td>24/124</td><td>12/151</td><td>62/158</td><td>70/118</td><td>8/91</td></tr><tr><td>四分位排名</td><td>优秀</td><td>优秀</td><td>良好</td><td>一般</td><td>优秀</td></tr><tr><td>基金规模26Q1(亿元)</td><td>993.49</td><td>4129.01</td><td>1262.03</td><td>1936.42</td><td>309.05</td></tr></tbody></table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

