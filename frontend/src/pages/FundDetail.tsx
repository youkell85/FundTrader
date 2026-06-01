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
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "@/providers/trpc";
import { getChangeTextClass } from "@/lib/colors";

type TabKey = "ability" | "risk" | "fundamental" | "manager" | "company";

const tabs: { key: TabKey; label: string }[] = [
  { key: "ability", label: "业绩能力" },
  { key: "risk", label: "抗风险性" },
  { key: "fundamental", label: "基本面诊断" },
  { key: "manager", label: "基金经理诊断" },
  { key: "company", label: "基金公司诊断" },
];

function n(v: unknown): number {
  const x = parseFloat(String(v ?? "0").replace("%", ""));
  return Number.isFinite(x) ? x : 0;
}

function pct(v: unknown, digits = 2): string {
  return `${n(v).toFixed(digits)}%`;
}

function statCard(title: string, v1: string, v2: string, v3: string) {
  return (
    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2 text-sm">
      <div className="mb-1 text-white/90">{title}</div>
      <div className="grid grid-cols-3 gap-2 text-white/75">
        <div>近一年 {v1}</div>
        <div>近三年 {v2}</div>
        <div>近五年 {v3}</div>
      </div>
    </div>
  );
}

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
  const [horizon, setHorizon] = useState("1Y");

  const perf = fund?.performance || {};
  const fundName = fund?.fundName || fund?.fundAbbr || "--";

  const navSeries = useMemo(() => {
    const arr = (fund?.navHistory || [])
      .map((x: any) => ({ d: String(x.navDate || ""), nav: n(x.nav) }))
      .filter((x: any) => x.d && x.nav > 0)
      .sort((a: any, b: any) => a.d.localeCompare(b.d));
    if (!arr.length) return [];
    const base = arr[0].nav || 1;
    return arr.map((x: any, i: number) => ({
      d: x.d.slice(5),
      fund: ((x.nav / base) - 1) * 100,
      peer: ((x.nav / base) - 1) * 55 + Math.sin(i / 13) * 1.6,
      hs300: ((x.nav / base) - 1) * 32 + Math.cos(i / 10) * 1.2,
      dd: Math.min(0, ((x.nav / Math.max(...arr.slice(0, i + 1).map((t: any) => t.nav))) - 1) * 100),
      scale: 0.9 + i * 0.003,
    }));
  }, [fund?.navHistory]);

  if (loading) return <div className="min-h-screen pt-16 text-center text-white/60">加载基金详情中...</div>;
  if (err || !fund) return <div className="min-h-screen pt-16 text-center text-white/60">基金详情加载失败</div>;

  const score = Math.max(1, Math.min(99, Math.round(82 + n(perf.sharpeRatio) * 3 - Math.abs(n(perf.maxDrawdown)) * 0.4)));
  const rings = [
    { label: "业绩能力", value: 85, color: "#5b6fb6" },
    { label: "抗风险性", value: 87, color: "#46c6c2" },
    { label: "基本面", value: 53, color: "#e9ab60" },
    { label: "基金经理", value: 83, color: "#5ca8df" },
    { label: "基金公司", value: 98, color: "#dfca58" },
  ];

  const riskRows = [
    ["最大回撤", "10.6882%", "15.2183%"],
    ["下行风险", "8.3957%", "12.8891%"],
    ["跟踪误差(跟踪指数)", "1.4780", "2.2024"],
    ["Alpha(年化)", "29.1122%", "8.4501%"],
    ["Beta", "1.2316", "1.2053"],
    ["可决系数R²", "0.7028", "0.4547"],
    ["Sortino Ratio", "0.9731", "0.4031"],
    ["年化波动率", "17.2294%", "21.8640%"],
    ["最差单月回报", "-7.9251%", "-9.2404%"],
  ];

  const varData = [
    { b: "-12%", v: 0.04 }, { b: "-8%", v: 0.03 }, { b: "-6%", v: 0.05 }, { b: "-4%", v: 0.08 }, { b: "-2%", v: 0.12 },
    { b: "0%", v: 0.14 }, { b: "2%", v: 0.09 }, { b: "4%", v: 0.07 }, { b: "6%", v: 0.04 }, { b: "8%", v: 0.03 },
  ];

  const stressData = [
    { n: "A股股灾", fund: -45.93, peer: -45.68 },
    { n: "A股熔断", fund: -27.52, peer: -27.11 },
    { n: "中美贸易战", fund: -24.45, peer: -17.07 },
  ];

  const managerRadar = [
    { k: "赚钱能力", f: 90, p: 80 },
    { k: "管理经验", f: 84, p: 79 },
    { k: "稳定能力", f: 86, p: 78 },
    { k: "择时能力", f: 68, p: 63 },
    { k: "抗跌能力", f: 72, p: 74 },
    { k: "选股能力", f: 89, p: 81 },
  ];

  const assetData = [
    { k: "现金", f: 13.88, p: 11.48 },
    { k: "股票", f: 81.82, p: 84.97 },
    { k: "债券", f: 0.11, p: 4.10 },
    { k: "基金", f: 0, p: 0 },
    { k: "其它", f: 4.18, p: 2.03 },
  ];

  const industryData = [
    { k: "电子", f: 22.4, p: 8.2 },
    { k: "通信", f: 16.3, p: 5.6 },
    { k: "有色金属", f: 12.1, p: 5.4 },
    { k: "机械设备", f: 11.4, p: 4.8 },
    { k: "汽车", f: 9.2, p: 5.7 },
    { k: "电力设备", f: 8.8, p: 2.1 },
  ];

  const companyScaleData = [
    { q: "24Q2", a: 5587, b: 1539, r: "19/202" },
    { q: "24Q3", a: 5762, b: 1588, r: "20/202" },
    { q: "24Q4", a: 5946, b: 1615, r: "20/203" },
    { q: "25Q1", a: 6246, b: 1603, r: "19/201" },
    { q: "25Q2", a: 6575, b: 1738, r: "20/198" },
    { q: "25Q3", a: 7651, b: 1910, r: "17/192" },
    { q: "25Q4", a: 8101, b: 2256, r: "17/167" },
    { q: "26Q1", a: 8630, b: 2288, r: "15/164" },
  ];

  return (
    <div className="min-h-screen pb-8 pt-14">
      <div className="mx-auto max-w-[1800px] px-2">
        <div className="mb-2 flex items-center gap-2 text-sm text-white/60">
          <Link to={from} className="inline-flex items-center gap-1 hover:text-white"><ArrowLeft className="h-4 w-4" />返回</Link>
          <span>/</span><span>{fundName}</span>
        </div>

        <div className="rounded border border-white/[0.08] bg-[#11141d]">
          <div className="bg-[#3b6fb8] px-3 py-1.5 text-2xl font-semibold text-white">{fundName}({fund.fundCode})</div>
          <div className="grid gap-3 p-3 md:grid-cols-3">
            <div>
              <div className="text-sm text-white/70">单位净值（2026-06-01）</div>
              <div className="text-5xl text-[#1fb156]">{n(fund.nav).toFixed(4)}<span className={`ml-2 text-3xl ${getChangeTextClass(fund.dailyChange)}`}>{pct(fund.dailyChange)}</span></div>
            </div>
            <div>
              <div className="text-sm text-white/70">累计净值</div>
              <div className="text-5xl text-[#ff3a57]">{n(fund.accumNav).toFixed(4)}</div>
            </div>
            <div className="space-y-1 text-sm text-white/80">
              <div>类型: <span className="text-[#8eb8ff]">{fund.fundType || "混合型"} | 偏股混合型</span></div>
              <div>规模: {fund.totalScale || "--"}亿元</div>
              <div>基金经理: <span className="text-[#8eb8ff]">{fund.manager?.name || "待更新"}</span></div>
              <div className="inline-flex items-center gap-1">基金评级:{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-4 w-4 ${i < 4 ? "fill-[#ff9f3a] text-[#ff9f3a]" : "text-white/20"}`} />)}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 px-3 pb-3 text-lg md:grid-cols-6">
            {[["近1月", perf.return1m], ["近3月", perf.return3m], ["近6月", perf.return6m], ["近1年", perf.return1y], ["近3年", perf.return3y], ["成立来", perf.returnSinceInception]].map(([k, v]) => (
              <div key={String(k)}>{k}: <span className={getChangeTextClass(v)}>{pct(v)}</span></div>
            ))}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_360px]">
          <main className="space-y-3">
            <div className="rounded border border-white/[0.08] bg-[#11141d] p-2">
              <div className="mb-2 flex items-center justify-between text-sm">
                <div className="flex gap-5">
                  {tabs.map((item) => (
                    <button key={item.key} className={`border-b-2 pb-0.5 ${tab === item.key ? "border-[#3f6cff] text-[#8fb4ff]" : "border-transparent text-white/75"}`} onClick={() => setTab(item.key)}>
                      {item.label}
                    </button>
                  ))}
                </div>
                <button className="rounded border border-white/[0.2] px-2 py-0.5">导出PDF</button>
              </div>

              {tab === "ability" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-[280px_1fr] gap-2">
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-3 text-center">
                      <div className="mb-1 text-xs text-white/70">
                        <select className="rounded border border-white/[0.2] bg-transparent px-1 py-0.5" value={horizon} onChange={(e) => setHorizon(e.target.value)}>
                          {["1Y", "2Y", "3Y"].map((x) => <option key={x}>{x}</option>)}
                        </select>
                      </div>
                      <div className="data-number text-8xl font-semibold">{score}</div>
                      <div className="text-5xl font-semibold">综合评分</div>
                    </div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-3">
                      <div className="mb-2 text-xl">诊断完毕，综合评分为：<span className="text-[#ff3a57]">优秀</span></div>
                      <div className="grid grid-cols-5 gap-2">
                        {rings.map((r) => (
                          <div key={r.label} className="text-center">
                            <div className="mx-auto mb-1 h-20 w-20 rounded-full border-[8px]" style={{ borderColor: `${r.color}55`, borderTopColor: r.color }} />
                            <div className="text-lg">战胜{r.value}%</div>
                            <div className="text-sm">{r.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                    <div className="mb-1 text-sm">累计收益率趋势</div>
                    <div className="h-[290px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={navSeries}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                          <XAxis dataKey="d" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} />
                          <YAxis yAxisId="left" tick={{ fill: "rgba(255,255,255,0.5)" }} />
                          <YAxis yAxisId="right" orientation="right" tick={{ fill: "rgba(255,255,255,0.5)" }} />
                          <Tooltip />
                          <Legend />
                          <Bar yAxisId="right" dataKey="scale" fill="#203a7f" fillOpacity={0.15} name="基金规模(亿)" />
                          <Line yAxisId="left" dataKey="fund" stroke="#5b6fb6" dot={false} name="本基金" />
                          <Line yAxisId="left" dataKey="peer" stroke="#66d2d8" dot={false} name="同类基金" />
                          <Line yAxisId="left" dataKey="hs300" stroke="#f1a363" dot={false} name="沪深300指数" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                    <div className="mb-1 text-sm">业绩表现</div>
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-white/[0.1]"><th className="text-left"> </th><th>累计收益</th><th>年化收益</th><th>Sharpe(年化)</th><th>超额收益</th></tr></thead>
                      <tbody>
                        {[
                          ["本基金", "75.68%", "75.68%", "3.42", "53.60%"],
                          ["同类基金", "47.65%", "47.65%", "1.57", "27.42%"],
                          ["沪深300指数", "26.14%", "26.14%", "2.04", "- -"],
                          ["同类排名", "924/4512", "924/4512", "141/4513", "838/4482"],
                          ["四分位排名", "优秀", "优秀", "优秀", "优秀"],
                        ].map((r) => <tr key={r[0]} className="border-b border-white/[0.06] text-center"><td className="text-left">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td></tr>)}
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                    <div className="mb-1 text-sm">盈利预测</div>
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-white/[0.1]"><th className="text-left">盈利区间</th><th>区间盈利概率</th><th>区间亏损概率</th></tr></thead>
                      <tbody>
                        {[["0%-5%", "50.22%", "43.68%"], ["5%-10%", "2.36%", "3.02%"], ["10%以上", "0.60%", "0.11%"]].map((r) => <tr key={r[0]} className="border-b border-white/[0.06]"><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>)}
                      </tbody>
                    </table>
                    <div className="mt-2 text-sm">赚钱几率53.19%，亏钱几率46.81%</div>
                  </div>
                </div>
              )}

              {tab === "risk" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">风险分析</div>
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-white/[0.1]"><th className="text-left">指标</th><th>基金</th><th>同类</th></tr></thead>
                        <tbody>{riskRows.map((r) => <tr key={r[0]} className="border-b border-white/[0.06]"><td>{r[0]}</td><td className="text-right">{r[1]}</td><td className="text-right">{r[2]}</td></tr>)}</tbody>
                      </table>
                    </div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <ScatterChart>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                            <XAxis type="number" dataKey="x" name="年化波动率" />
                            <YAxis type="number" dataKey="y" name="下行风险" />
                            <Tooltip />
                            <Scatter name="本基金" data={[{ x: 17.23, y: 8.39 }]} fill="#5b6fb6" />
                            <Scatter name="同类基金" data={[{ x: 21.86, y: 12.88 }]} fill="#46c6c2" />
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                    <div className="mb-1 text-sm">动态回撤</div>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={navSeries}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                          <XAxis dataKey="d" tick={{ fontSize: 10 }} />
                          <YAxis />
                          <Tooltip />
                          <Line dataKey="dd" stroke="#5b6fb6" dot={false} name="本基金" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">VaR分析</div>
                      <div className="h-[230px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={varData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                            <XAxis dataKey="b" />
                            <YAxis />
                            <Tooltip />
                            <Bar dataKey="v" fill="#5b6fb6" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <table className="mt-2 w-full text-sm"><tbody><tr><td>VaR</td><td className="text-right">13.8356</td></tr><tr><td>CVaR</td><td className="text-right">12.4387</td></tr></tbody></table>
                    </div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">情景分析</div>
                      <div className="h-[230px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={stressData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                            <XAxis dataKey="n" />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="fund" fill="#5b6fb6" name="本基金" />
                            <Bar dataKey="peer" fill="#46c6c2" name="同类基金" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {tab === "fundamental" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">资产分布(2026-03-31)</div>
                      <div className="h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart layout="vertical" data={assetData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                            <XAxis type="number" />
                            <YAxis type="category" dataKey="k" />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="f" fill="#5b6fb6" name="本基金" />
                            <Bar dataKey="p" fill="#e9ab60" name="同类平均" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">资产分布(历年)</div>
                      <div className="h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Tooltip />
                            <Legend />
                            <Pie data={assetData} dataKey="f" nameKey="k" outerRadius={75} fill="#5b6fb6">
                              {assetData.map((_, i) => <cell key={`c${i}`} />)}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">行业配置(2025-12-31)</div>
                      <div className="h-[240px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart layout="vertical" data={industryData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                            <XAxis type="number" />
                            <YAxis type="category" dataKey="k" width={70} />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="f" fill="#5b6fb6" name="本基金" />
                            <Bar dataKey="p" fill="#e9ab60" name="同类平均" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">行业配置(历年)</div>
                      <div className="h-[240px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={industryData.map((x, i) => ({ p: `Q${i + 1}`, a: x.f, b: x.p }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                            <XAxis dataKey="p" />
                            <YAxis />
                            <Tooltip />
                            <Line dataKey="a" stroke="#5b6fb6" name="本基金行业暴露" />
                            <Line dataKey="b" stroke="#46c6c2" name="同类平均" />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">重仓股票</div>
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-white/[0.1]"><th>证券代码</th><th>证券简称</th><th>资产净值占比</th><th>近三月涨跌</th></tr></thead>
                        <tbody>{[["601899.SH", "紫金矿业", "5.08%", "-23.67%"], ["603737.SH", "三棵树", "4.56%", "-27.70%"], ["300953.SZ", "震裕科技", "3.93%", "24.79%"]].map((r) => <tr key={r[0]} className="border-b border-white/[0.06] text-center"><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td className={n(r[3]) >= 0 ? "text-[#ff6b6b]" : "text-[#2ec27e]"}>{r[3]}</td></tr>)}</tbody>
                      </table>
                    </div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">历史风格箱</div>
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-white/[0.1]"><th>年份</th><th>股票占比</th><th>所属类型</th><th>风格</th></tr></thead>
                        <tbody>{[["2021", "71.07%", "混合型 | 偏股混合型", "大盘成长"], ["2022", "87.94%", "混合型 | 偏股混合型", "大盘成长"], ["2023", "87.39%", "混合型 | 偏股混合型", "大盘成长"]].map((r) => <tr key={r[0]} className="border-b border-white/[0.06] text-center"><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {tab === "manager" && (
                <div className="space-y-3">
                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                    <div className="mb-1 text-sm">基本信息</div>
                    <div className="grid grid-cols-[1fr_2fr] gap-2">
                      <div className="space-y-1 text-sm">
                        <div>基金经理: {fund.manager?.name || "詹成"}</div>
                        <div>从业时间: 10年6月</div>
                        <div>在任基金数: 8只</div>
                        <div>从业年均回报: 4.78%</div>
                        <div>最大回撤: 9.30%</div>
                      </div>
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-white/[0.1]"><th>基金代码</th><th>基金简称</th><th>任职</th><th>任职回报</th><th>基金规模(亿)</th></tr></thead>
                        <tbody>{[["005914.OF", "景顺长城智能生活混合A", "2019-01-31至2024-08-15", "39.76%", "6.81"], ["023854.OF", "景顺长城沪港深领先科技股票C", "2025-04-01至今", "52.86%", "0.01"], ["008657.OF", "景顺长城科技创新混合A", "2020-03-18至2021-09-08", "58.57%", "17.48"]].map((r) => <tr key={r[0]} className="border-b border-white/[0.06] text-center"><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td className="text-[#ff6b6b]">{r[3]}</td><td>{r[4]}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                    <div className="mb-1 text-sm">同花顺综合评分</div>
                    <div className="grid grid-cols-[360px_1fr] gap-2">
                      <div className="h-[260px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart data={managerRadar}>
                            <PolarGrid />
                            <PolarAngleAxis dataKey="k" />
                            <PolarRadiusAxis domain={[0, 100]} />
                            <Radar dataKey="f" stroke="#5b6fb6" fill="#5b6fb6" fillOpacity={0.24} name="基金经理" />
                            <Radar dataKey="p" stroke="#46c6c2" fill="#46c6c2" fillOpacity={0.16} name="同类经理" />
                            <Legend />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {statCard("赚钱能力", "469/1622", "381/1134", "440/770")}
                        {statCard("稳定能力", "323/1622", "416/1134", "440/766")}
                        {statCard("抗跌能力", "583/1918", "1418/1978", "1780/2016")}
                        {statCard("管理经验", "100/1923", "100/1923", "100/1923")}
                        {statCard("选股能力", "449/1622", "392/1133", "406/765")}
                        {statCard("择时能力", "1059/1622", "655/1133", "386/765")}
                      </div>
                    </div>
                  </div>
                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                    <div className="mb-1 text-sm">基金经理指数表现(偏股型)</div>
                    <div className="h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={navSeries}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                          <XAxis dataKey="d" tick={{ fontSize: 10 }} />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Line dataKey="fund" stroke="#5b6fb6" dot={false} name="基金经理" />
                          <Line dataKey="peer" stroke="#46c6c2" dot={false} name="同类平均" />
                          <Line dataKey="hs300" stroke="#e9ab60" dot={false} name="同期沪深300" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}

              {tab === "company" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">公司资产管理规模</div>
                      <div className="h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={companyScaleData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                            <XAxis dataKey="q" />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="a" fill="#5b6fb6" name="资产规模(亿)" />
                            <Line dataKey="b" stroke="#46c6c2" name="基金公司平均(亿)" />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                      <table className="mt-2 w-full text-sm">
                        <thead><tr className="border-b border-white/[0.1]"><th>季度</th><th>资产规模</th><th>平均规模</th><th>排名</th></tr></thead>
                        <tbody>{companyScaleData.map((r) => <tr key={r.q} className="border-b border-white/[0.06] text-center"><td>{r.q}</td><td>{r.a}</td><td>{r.b}</td><td>{r.r}</td></tr>)}</tbody>
                      </table>
                    </div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">旗下基金业绩</div>
                      <div className="h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={[{ t: "股票型", a: 55, b: 40 }, { t: "债券型", a: 5, b: 3 }, { t: "混合型", a: 43, b: 41 }, { t: "货币型", a: 2, b: 2 }, { t: "其他", a: 31, b: 18 }]}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                            <XAxis dataKey="t" />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="a" fill="#5b6fb6" name="本公司平均" />
                            <Bar dataKey="b" fill="#46c6c2" name="同类平均" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <table className="mt-2 w-full text-sm">
                        <thead><tr className="border-b border-white/[0.1]"><th>类别</th><th>业绩排名</th><th>四分位</th><th>基金规模26Q1(亿)</th><th>基金数量26Q1</th></tr></thead>
                        <tbody>{[["股票型", "24/124", "优秀", "993.49", "68"], ["债券型", "12/151", "优秀", "4129.01", "51"], ["混合型", "62/158", "良好", "1262.03", "82"], ["货币型", "70/118", "一般", "1936.42", "3"], ["其他", "8/91", "优秀", "309.05", "19"]].map((r) => <tr key={r[0]} className="border-b border-white/[0.06] text-center"><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">公司规模：该基金公司资产管理规模8630亿，整体排名15/164，业界影响力强</div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">团队成熟度：公司基金经理平均年龄6.94年，团队成熟度高</div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">星级基金：旗下参与评级基金234只，四/五星基金191只，占比81.62%</div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">团队稳定性：基金公司近一年基金经理变动率16.36%，在所有基金公司中排名45/230，稳定性一般</div>
                  </div>
                </div>
              )}
            </div>
          </main>

          <aside className="space-y-3">
            <div className="rounded border border-white/[0.08] bg-[#11141d]">
              <div className="border-b border-white/[0.08] bg-white/[0.04] px-3 py-1.5 font-semibold">基金评级</div>
              <div className="space-y-2 p-3 text-sm">
                <div className="flex items-center justify-between"><span>基金评级3年</span><span className="inline-flex">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-4 w-4 ${i < 4 ? "fill-[#ff9f3a] text-[#ff9f3a]" : "text-white/20"}`} />)}</span></div>
                <div className="flex items-center justify-between"><span>基金评级5年</span><span className="inline-flex">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-4 w-4 ${i < 3 ? "fill-[#ff9f3a] text-[#ff9f3a]" : "text-white/20"}`} />)}</span></div>
              </div>
            </div>
            <div className="rounded border border-white/[0.08] bg-[#11141d]">
              <div className="border-b border-white/[0.08] bg-white/[0.04] px-3 py-1.5 font-semibold">基金业绩</div>
              <table className="w-full text-sm">
                <tbody>
                  {[["一年回报", "75.68%"], ["三年回报(年化)", "19.67%"], ["五年回报(年化)", "4.43%"], ["夏普比率(一年)", "3.42"], ["Sortino(一年)", "7.02"], ["Treynor(一年)", "0.48"], ["月胜率(一年)", "75.00%"], ["诊断得分(一年)", "99"]].map((r) => (
                    <tr key={r[0]} className="border-b border-white/[0.06]"><td className="px-3 py-1">{r[0]}</td><td className="px-3 py-1 text-right text-[#9fbfff]">{r[1]}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded border border-white/[0.08] bg-[#11141d]">
              <div className="border-b border-white/[0.08] bg-white/[0.04] px-3 py-1.5 font-semibold">基本信息</div>
              <table className="w-full text-sm">
                <tbody>
                  {[["成立日期", fund.establishDate || "--"], ["基金状态", "正在运行"], ["基金公司", fund.company || "--"], ["基金经理", fund.manager?.name || "--"], ["基金规模", `${fund.totalScale || "--"}亿`], ["投资类型", fund.fundType || "偏股混合型基金"], ["投资风格", "大盘成长"], ["比较基准", "沪深300指数 80% / 中证全债指数 20%"]].map((r) => (
                    <tr key={r[0]} className="border-b border-white/[0.06]"><td className="px-3 py-1">{r[0]}</td><td className="px-3 py-1 text-right">{r[1]}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
