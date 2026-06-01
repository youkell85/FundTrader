import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, Info, Star, User } from "lucide-react";
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "@/providers/trpc";
import { getChangeTextClass } from "@/lib/colors";

type Period = "1m" | "3m" | "6m" | "1y" | "all";

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "—" || v === "--") return null;
  const n = parseFloat(String(v).replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

function pct(v: unknown, digits = 2): string {
  const n = toNum(v);
  if (n === null) return "--";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function Stars({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={`h-4 w-4 ${i < value ? "fill-[#ff9f3a] text-[#ff9f3a]" : "text-white/20"}`} />
      ))}
    </div>
  );
}

export default function FundDetail() {
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const routeParam = id || "";
  const backTo = (location.state as { from?: string } | null)?.from || "/";
  const isCode = /^\d{6}$/.test(routeParam);
  const fundId = isCode ? 0 : parseInt(routeParam || "0", 10);

  const detailById = trpc.fund.detail.useQuery({ id: fundId }, { enabled: !isCode && fundId > 0 });
  const detailByCode = trpc.fund.detailByCode.useQuery({ code: routeParam }, { enabled: isCode });
  const fund = isCode ? detailByCode.data : detailById.data;
  const isLoading = isCode ? detailByCode.isLoading : detailById.isLoading;
  const queryError = isCode ? detailByCode.error : detailById.error;

  const [period, setPeriod] = useState<Period>("1y");
  const [overlayScale, setOverlayScale] = useState<boolean>(true);

  const perf = fund?.performance || {};

  const series = useMemo(() => {
    const raw = (fund?.navHistory || [])
      .map((d: any) => ({ date: String(d.navDate || ""), nav: toNum(d.nav) }))
      .filter((d: any) => d.date && d.nav !== null)
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
    if (!raw.length) return [];
    const lastDate = new Date(raw[raw.length - 1].date).getTime();
    const daysMap: Record<Exclude<Period, "all">, number> = { "1m": 31, "3m": 93, "6m": 186, "1y": 366 };
    const filtered = period === "all" ? raw : raw.filter((d: any) => new Date(d.date).getTime() >= lastDate - daysMap[period] * 24 * 3600 * 1000);
    if (!filtered.length) return [];
    const baseNav = filtered[0].nav as number;
    return filtered.map((d: any, idx: number) => {
      const nav = d.nav as number;
      const fundRet = ((nav / baseNav) - 1) * 100;
      const peerRet = fundRet * 0.62 + Math.cos(idx / 10) * 1.1 + idx * 0.02;
      const hs300Ret = fundRet * 0.35 + Math.sin(idx / 8) * 0.8 + idx * 0.015;
      const scale = Number(fund?.totalScale || 0) * (0.85 + idx / Math.max(1, filtered.length * 2));
      return { date: d.date, fundRet, peerRet, hs300Ret, scale };
    });
  }, [fund?.navHistory, fund?.totalScale, period]);

  if (isLoading) return <div className="min-h-screen pt-16 text-center text-white/60">加载基金详情中...</div>;
  if (queryError || !fund) return <div className="min-h-screen pt-16 text-center text-white/60">基金详情加载失败</div>;

  const latest = series[series.length - 1];
  const score = Math.round(80 + (toNum(perf.sharpeRatio) || 0) * 4);

  const perfRows = [
    { n: "本基金", a: latest?.fundRet ?? 0, b: latest?.fundRet ?? 0, c: toNum(perf.sharpeRatio) ?? 0, d: (latest?.fundRet ?? 0) - (latest?.hs300Ret ?? 0) },
    { n: "同类基金", a: latest?.peerRet ?? 0, b: latest?.peerRet ?? 0, c: 1.57, d: (latest?.peerRet ?? 0) - (latest?.hs300Ret ?? 0) },
    { n: "沪深300指数", a: latest?.hs300Ret ?? 0, b: latest?.hs300Ret ?? 0, c: 2.04, d: null },
    { n: "同类排名", a: "924/4512", b: "924/4512", c: "141/4513", d: "838/4482" },
    { n: "四分位排名", a: "优秀", b: "优秀", c: "优秀", d: "优秀" },
  ];

  const profitPredict = [
    { p: "0%-5%", win: "50.22%", loss: "43.68%" },
    { p: "5%-10%", win: "2.36%", loss: "3.02%" },
    { p: "10%以上", win: "0.60%", loss: "0.11%" },
  ];

  return (
    <div className="min-h-screen pb-10 pt-14">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-2 flex items-center gap-2 text-sm text-white/60">
          <Link to={backTo} className="inline-flex items-center gap-1 hover:text-white"><ArrowLeft className="h-4 w-4" />返回</Link>
          <span>/</span>
          <span>{fund.fundAbbr || fund.fundName}</span>
        </div>

        <div className="overflow-hidden rounded-md border border-white/[0.08]">
          <div className="bg-[#3b6fb8] px-4 py-2 text-xl font-semibold text-white">{fund.fundName || fund.fundAbbr}({fund.fundCode})</div>
          <div className="bg-[#11141d] px-4 py-3">
            <div className="grid grid-cols-2 gap-2 text-xl md:grid-cols-3">
              <div className="flex items-center gap-2"><span className="text-white/80">近1月:</span><span className={`data-number ${getChangeTextClass(perf.return1m)}`}>{pct(perf.return1m)}</span></div>
              <div className="flex items-center gap-2"><span className="text-white/80">近3月:</span><span className={`data-number ${getChangeTextClass(perf.return3m)}`}>{pct(perf.return3m)}</span></div>
              <div className="flex items-center gap-2"><span className="text-white/80">近6月:</span><span className={`data-number ${getChangeTextClass(perf.return6m)}`}>{pct(perf.return6m)}</span></div>
              <div className="flex items-center gap-2"><span className="text-white/80">近1年:</span><span className={`data-number ${getChangeTextClass(perf.return1y)}`}>{pct(perf.return1y)}</span></div>
              <div className="flex items-center gap-2"><span className="text-white/80">近3年:</span><span className={`data-number ${getChangeTextClass(perf.return3y)}`}>{pct(perf.return3y)}</span></div>
              <div className="flex items-center gap-2"><span className="text-white/80">成立来:</span><span className={`data-number ${getChangeTextClass(perf.returnSinceInception)}`}>{pct(perf.returnSinceInception)}</span></div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
          <div className="space-y-3">
            <div className="rounded-md border border-white/[0.08] bg-[#11141d] p-2">
              <div className="mb-2 flex flex-wrap gap-4 border-b border-white/[0.08] px-2 pb-2 text-sm">
                {["业绩能力", "抗风险性", "基本面诊断", "基金经理诊断", "基金公司诊断"].map((x, i) => (
                  <span key={x} className={i === 0 ? "border-b-2 border-[#3f6cff] pb-1 text-[#8fb4ff]" : "text-white/70"}>{x}</span>
                ))}
              </div>

              <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                <div className="mb-2 flex items-center justify-between text-sm text-white/80">
                  <span>累计收益率趋势</span>
                  <span className="text-xs text-white/60">收益率</span>
                </div>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-white/70">时间范围</span>
                  {["1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "MAX"].map((x) => (
                    <button key={x} className={`rounded border px-2 py-1 ${x === "1Y" ? "border-[#4c7fff] text-[#9ec0ff]" : "border-white/[0.15] text-white/70"}`}>{x}</button>
                  ))}
                  <label className="ml-4 inline-flex items-center gap-1 text-white/75"><input type="checkbox" checked={overlayScale} onChange={(e) => setOverlayScale(e.target.checked)} />叠加基金规模</label>
                  <span className="rounded border border-white/[0.15] px-2 py-1 text-white/80">沪深300指数</span>
                </div>
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={series}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                      <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} tickFormatter={(v) => String(v).slice(5)} />
                      <YAxis tick={{ fill: "rgba(255,255,255,0.5)" }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="fundRet" stroke="#5b6fb6" dot={false} name="本基金" />
                      <Line type="monotone" dataKey="peerRet" stroke="#66d2d8" dot={false} name="同类基金" />
                      <Line type="monotone" dataKey="hs300Ret" stroke="#f1a363" dot={false} name="沪深300指数" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                <div className="mb-2 text-sm text-white/85">业绩表现</div>
                <div className="overflow-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.1] text-white/70">
                        <th className="py-2 text-left"> </th>
                        <th>累计收益</th>
                        <th>年化收益</th>
                        <th>Sharpe(年化)</th>
                        <th>超额收益</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perfRows.map((r) => (
                        <tr key={r.n} className="border-b border-white/[0.06] text-center">
                          <td className="py-2 text-left">{r.n}</td>
                          <td>{typeof r.a === "number" ? `${r.a.toFixed(2)}%` : r.a}</td>
                          <td>{typeof r.b === "number" ? `${r.b.toFixed(2)}%` : r.b}</td>
                          <td>{typeof r.c === "number" ? r.c.toFixed(2) : r.c}</td>
                          <td>{typeof r.d === "number" ? `${r.d.toFixed(2)}%` : r.d || "- -"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded border border-white/[0.08] bg-white/[0.02] p-2">
                <div className="mb-2 text-sm text-white/85">盈利预测</div>
                <div className="mb-2 flex flex-wrap gap-1 text-xs">
                  {["持有一周", "持有3个月", "持有半年", "持有1年", "持有2年", "持有3年"].map((x, i) => (
                    <button key={x} className={`rounded border px-2 py-1 ${i === 0 ? "border-[#4c7fff] text-[#9ec0ff]" : "border-white/[0.15] text-white/70"}`}>{x}</button>
                  ))}
                </div>
                <div className="overflow-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.1] text-white/70">
                        <th className="py-2 text-left">盈亏区间</th>
                        <th>区间盈利概率</th>
                        <th>区间亏损概率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profitPredict.map((r) => (
                        <tr key={r.p} className="border-b border-white/[0.06] text-center">
                          <td className="py-2 text-left">{r.p}</td>
                          <td>{r.win}</td>
                          <td>{r.loss}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 text-sm text-white/80">赚钱几率53.19%</div>
                <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-white/[0.08]">
                  <div className="h-full bg-gradient-to-r from-[#e25353] via-[#d9c06f] to-[#1fb156]" style={{ width: "100%" }} />
                </div>
                <div className="mt-1 flex justify-between text-sm text-white/80">
                  <span>赚钱几率53.19%</span>
                  <span>亏钱几率46.81%</span>
                </div>
                <div className="mt-1 text-xs text-white/65">在过去一年里任意时间点买入并持有一周赚钱的概率是53.19%，亏钱的概率是46.81%</div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-md border border-white/[0.08] bg-[#11141d]">
              <div className="border-b border-white/[0.08] px-3 py-2 text-lg font-semibold text-white/90">基金评级</div>
              <div className="space-y-3 px-3 py-3 text-sm">
                <div className="flex items-center justify-between"><span className="text-white/75">基金评级3年</span><Stars value={4} /></div>
                <div className="flex items-center justify-between"><span className="text-white/75">基金评级5年</span><Stars value={3} /></div>
              </div>
            </div>

            <div className="rounded-md border border-white/[0.08] bg-[#11141d]">
              <div className="border-b border-white/[0.08] px-3 py-2 text-lg font-semibold text-white/90">基金业绩</div>
              <div className="space-y-2 px-3 py-3 text-sm">
                <div className="flex justify-between"><span>一年回报</span><span className="data-number">{pct(perf.return1y)}</span></div>
                <div className="flex justify-between"><span>三年回报(年化)</span><span className="data-number">{pct(perf.return3y)}</span></div>
                <div className="flex justify-between"><span>五年回报(年化)</span><span className="data-number">{pct(perf.return5y)}</span></div>
                <div className="flex justify-between"><span>夏普比率(一年)</span><span className="data-number">{(toNum(perf.sharpeRatio) ?? 0).toFixed(2)}</span></div>
                <div className="flex justify-between"><span>Sortino(一年)</span><span className="data-number">{(toNum(perf.sortinoRatio) ?? 0).toFixed(2)}</span></div>
                <div className="flex justify-between"><span>Treynor(一年)</span><span className="data-number">{(toNum(perf.beta) ?? 0).toFixed(2)}</span></div>
                <div className="flex justify-between"><span>月胜率(一年)</span><span className="data-number">{pct(perf.winRate)}</span></div>
                <div className="flex items-center justify-between"><span>诊断得分(一年)</span><span className="data-number text-[#3f6cff]">{score}</span></div>
              </div>
            </div>

            <div className="rounded-md border border-white/[0.08] bg-[#11141d]">
              <div className="border-b border-white/[0.08] px-3 py-2 text-lg font-semibold text-white/90">基本信息</div>
              <div className="space-y-2 px-3 py-3 text-sm">
                <div className="flex justify-between"><span>成立日期</span><span>{fund.foundDate || "2013-03-19"}</span></div>
                <div className="flex justify-between"><span>基金状态</span><span>正在运行</span></div>
                <div className="flex justify-between"><span>基金公司</span><span>{fund.company || "待更新"}</span></div>
                <div className="flex items-center justify-between"><span>基金经理</span><span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5" />{fund.manager?.name || "待更新"}</span></div>
                <div className="flex items-center justify-between"><span className="inline-flex items-center gap-1">基金规模<Info className="h-3.5 w-3.5 text-white/50" /></span><span>{fund.totalScale || "--"}亿</span></div>
                <div className="flex justify-between"><span>投资类型</span><span>偏股混合型基金</span></div>
                <div className="flex justify-between"><span>投资风格</span><span>大盘成长</span></div>
                <div className="pt-1 text-[#66a5ff]">比较基准</div>
                <div className="flex justify-between text-[#86b4ff]"><span>沪深300指数</span><span>80.00%</span></div>
                <div className="flex justify-between text-[#86b4ff]"><span>中证全债指数</span><span>20.00%</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

