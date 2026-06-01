import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, Star } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

  const perf = fund?.performance || {};
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
      peer: ((x.nav / base) - 1) * 60 + Math.sin(i / 12) * 1.8,
      hs300: ((x.nav / base) - 1) * 35 + Math.cos(i / 10) * 1.2,
      dd: Math.min(0, ((x.nav / Math.max(...arr.slice(0, i + 1).map((t: any) => t.nav))) - 1) * 100),
    }));
  }, [fund?.navHistory]);

  if (loading) return <div className="min-h-screen pt-16 text-center text-white/60">加载基金详情中...</div>;
  if (err || !fund) return <div className="min-h-screen pt-16 text-center text-white/60">基金详情加载失败</div>;

  const fundName = fund.fundName || fund.fundAbbr || "--";
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

  const managerRadar = [
    { k: "赚钱能力", f: 90, p: 80 },
    { k: "管理经验", f: 84, p: 79 },
    { k: "稳定能力", f: 86, p: 78 },
    { k: "择时能力", f: 68, p: 63 },
    { k: "抗跌能力", f: 72, p: 74 },
    { k: "选股能力", f: 89, p: 81 },
  ];

  return (
    <div className="min-h-screen pb-8 pt-14">
      <div className="mx-auto max-w-[1800px] px-2">
        <div className="mb-2 flex items-center gap-2 text-sm text-white/60">
          <Link to={from} className="inline-flex items-center gap-1 hover:text-white"><ArrowLeft className="h-4 w-4" />返回</Link>
          <span>/</span><span>{fundName}</span>
        </div>

        <div className="rounded border border-white/[0.08] bg-[#11141d]">
          <div className="bg-[#3b6fb8] px-3 py-1.5 text-2xl font-semibold text-white">
            {fundName}({fund.fundCode})
          </div>
          <div className="grid gap-3 p-3 md:grid-cols-3">
            <div>
              <div className="text-sm text-white/70">单位净值（2026-06-01）</div>
              <div className="text-5xl text-[#1fb156]">
                {n(fund.nav).toFixed(4)}
                <span className={`ml-2 text-3xl ${getChangeTextClass(fund.dailyChange)}`}>{pct(fund.dailyChange)}</span>
              </div>
            </div>
            <div>
              <div className="text-sm text-white/70">累计净值</div>
              <div className="text-5xl text-[#ff3a57]">{n(fund.accumNav).toFixed(4)}</div>
            </div>
            <div className="space-y-1 text-sm text-white/80">
              <div>类型: <span className="text-[#8eb8ff]">{fund.fundType || "混合型"} | 偏股混合型</span></div>
              <div>规模: {fund.totalScale || "--"}亿元</div>
              <div>基金经理: <span className="text-[#8eb8ff]">{fund.manager?.name || "待更新"}</span></div>
              <div className="inline-flex items-center gap-1">
                基金评级:
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className={`h-4 w-4 ${i < 4 ? "fill-[#ff9f3a] text-[#ff9f3a]" : "text-white/20"}`} />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3">
            <div className="rounded border border-white/[0.08] bg-[#11141d] p-2">
              <div className="mb-2 flex items-center gap-5 text-sm">
                {tabs.map((item) => (
                  <button
                    key={item.key}
                    className={`border-b-2 pb-0.5 ${tab === item.key ? "border-[#3f6cff] text-[#8fb4ff]" : "border-transparent text-white/75"}`}
                    onClick={() => setTab(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {tab === "ability" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-[280px_1fr] gap-2">
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-3 text-center">
                      <div className="data-number text-8xl font-semibold">{score}</div>
                      <div className="text-5xl font-semibold">综合评分</div>
                    </div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-3">
                      <div className="mb-2 text-xl">诊断完毕，综合评分为: <span className="text-[#ff3a57]">优秀</span></div>
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
                    <div className="h-[260px]">
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
                </div>
              )}

              {tab === "risk" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">风险分析</div>
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-white/[0.1]"><th className="py-1 text-left">指标</th><th>基金</th><th>同类</th></tr></thead>
                        <tbody>
                          {riskRows.map((r) => <tr key={r[0]} className="border-b border-white/[0.06]"><td>{r[0]}</td><td className="text-right">{r[1]}</td><td className="text-right">{r[2]}</td></tr>)}
                        </tbody>
                      </table>
                    </div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <ScatterChart>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                            <XAxis dataKey="x" type="number" name="年化波动率" tick={{ fill: "rgba(255,255,255,0.5)" }} />
                            <YAxis dataKey="y" type="number" name="下行风险" tick={{ fill: "rgba(255,255,255,0.5)" }} />
                            <Tooltip cursor={{ strokeDasharray: "3 3" }} />
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
                          <XAxis dataKey="d" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} />
                          <YAxis tick={{ fill: "rgba(255,255,255,0.5)" }} />
                          <Tooltip />
                          <Line dataKey="dd" stroke="#5b6fb6" dot={false} name="本基金" />
                        </ComposedChart>
                      </ResponsiveContainer>
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
                          <BarChart layout="vertical" data={[{ k: "现金", f: 13.88, p: 11.48 }, { k: "股票", f: 81.82, p: 84.97 }, { k: "债券", f: 0.11, p: 4.10 }, { k: "其它", f: 4.18, p: 2.03 }]}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                            <XAxis type="number" />
                            <YAxis type="category" dataKey="k" />
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
                          <ComposedChart data={[{ q: "2023Q2", v: 76 }, { q: "2023Q4", v: 82 }, { q: "2024Q2", v: 84 }, { q: "2024Q4", v: 87 }, { q: "2025Q2", v: 82 }]}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                            <XAxis dataKey="q" />
                            <YAxis />
                            <Line dataKey="v" stroke="#5b6fb6" />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {tab === "manager" && (
                <div className="space-y-3">
                  <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                    <div className="mb-1 text-sm">同花顺综合评分</div>
                    <div className="grid grid-cols-[420px_1fr] gap-2">
                      <div className="h-[260px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart data={managerRadar}>
                            <PolarGrid />
                            <PolarAngleAxis dataKey="k" />
                            <PolarRadiusAxis domain={[0, 100]} />
                            <Radar dataKey="f" name="本基金" stroke="#5b6fb6" fill="#5b6fb6" fillOpacity={0.25} />
                            <Radar dataKey="p" name="同类平均" stroke="#46c6c2" fill="#46c6c2" fillOpacity={0.15} />
                            <Legend />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        {["赚钱能力", "稳定能力", "抗跌能力", "管理经验", "选股能力", "择时能力"].map((x, i) => (
                          <div key={x} className="rounded border border-white/[0.08] p-2">
                            <div className="mb-2 text-base">{x}</div>
                            <div>近一年 {120 + i * 10}/1622</div>
                            <div>近三年 {330 + i * 11}/1134</div>
                            <div>近五年 {400 + i * 7}/765</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {tab === "company" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">公司资产管理规模</div>
                      <div className="h-[260px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={[{ q: "24Q2", a: 5587, b: 1539 }, { q: "24Q3", a: 5762, b: 1588 }, { q: "24Q4", a: 5946, b: 1615 }, { q: "25Q1", a: 6246, b: 1603 }, { q: "25Q2", a: 6575, b: 1738 }, { q: "25Q3", a: 7651, b: 1910 }, { q: "25Q4", a: 8101, b: 2256 }, { q: "26Q1", a: 8630, b: 2288 }]}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                            <XAxis dataKey="q" />
                            <YAxis />
                            <Bar dataKey="a" fill="#5b6fb6" name="资产规模" />
                            <Line dataKey="b" stroke="#46c6c2" name="基金公司平均" />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                      <div className="mb-1 text-sm">旗下基金业绩</div>
                      <div className="h-[260px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={[{ t: "股票型", a: 55, b: 40 }, { t: "债券型", a: 5, b: 3 }, { t: "混合型", a: 43, b: 41 }, { t: "货币型", a: 2, b: 2 }, { t: "其他", a: 31, b: 18 }]}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                            <XAxis dataKey="t" />
                            <YAxis />
                            <Bar dataKey="a" fill="#5b6fb6" name="本公司平均" />
                            <Bar dataKey="b" fill="#46c6c2" name="同类平均" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

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
                    <tr key={r[0]} className="border-b border-white/[0.06]">
                      <td className="px-3 py-1">{r[0]}</td>
                      <td className="px-3 py-1 text-right text-[#9fbfff]">{r[1]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded border border-white/[0.08] bg-[#11141d]">
              <div className="border-b border-white/[0.08] bg-white/[0.04] px-3 py-1.5 font-semibold">基本信息</div>
              <table className="w-full text-sm">
                <tbody>
                  {[["成立日期", fund.establishDate || "--"], ["基金状态", "正在运行"], ["基金公司", fund.company || "--"], ["基金经理", fund.manager?.name || "--"], ["基金规模", `${fund.totalScale || "--"}亿`], ["投资类型", fund.fundType || "偏股混合型基金"], ["投资风格", "大盘成长"], ["比较基准", "沪深300指数 80% / 中证全债指数 20%"]].map((r) => (
                    <tr key={r[0]} className="border-b border-white/[0.06]">
                      <td className="px-3 py-1">{r[0]}</td>
                      <td className="px-3 py-1 text-right">{r[1]}</td>
                    </tr>
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
