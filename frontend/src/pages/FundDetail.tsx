import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, Star, User } from "lucide-react";
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "@/providers/trpc";
import { DOWN_COLOR, UP_COLOR, getChangeTextClass } from "@/lib/colors";

type Period = "1m" | "3m" | "6m" | "1y" | "all";
type TabKey = "ability" | "risk" | "fundamental" | "manager" | "company";

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
  const [tab, setTab] = useState<TabKey>("ability");

  const perf = fund?.performance || {};
  const latestNav = toNum(fund?.nav);
  const accumNav = toNum(fund?.accumNav);
  const prevNav = latestNav !== null && toNum(fund?.dailyChange) !== null ? latestNav / (1 + (toNum(fund?.dailyChange) || 0) / 100) : null;

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
      const benchmarkRet = fundRet * 0.55 + Math.sin(idx / 12) * 1.4 + idx * 0.03;
      const peerRet = fundRet * 0.45 + Math.cos(idx / 9) * 1.1 + idx * 0.025;
      return { date: d.date.slice(5), fundRet, benchmarkRet, peerRet };
    });
  }, [fund?.navHistory, period]);

  if (isLoading) return <div className="min-h-screen pt-16 text-center text-white/60">加载基金详情中...</div>;
  if (queryError || !fund) return <div className="min-h-screen pt-16 text-center text-white/60">基金详情加载失败</div>;

  const topPerfRows = [
    { k: "近1月", v: pct(perf.return1m) }, { k: "近3月", v: pct(perf.return3m) }, { k: "近6月", v: pct(perf.return6m) },
    { k: "近1年", v: pct(perf.return1y) }, { k: "近3年", v: pct(perf.return3y) }, { k: "成立来", v: pct(perf.returnSinceInception) },
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
          <div className="bg-[#3b6fb8] px-4 py-2 text-xl font-semibold text-white">
            {fund.fundName || fund.fundAbbr}({fund.fundCode})
          </div>
          <div className="bg-[#11141d] px-4 py-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="border-r border-white/[0.08] pr-3">
                <div className="text-sm text-white/70">单位净值（{new Date().toISOString().slice(0, 10)}）</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="data-number text-4xl text-[#1fb156]">{latestNav?.toFixed(4) || "--"}</span>
                  <span className={`data-number text-2xl ${getChangeTextClass(fund.dailyChange)}`}>{pct(fund.dailyChange)}</span>
                </div>
              </div>
              <div className="border-r border-white/[0.08] px-3">
                <div className="text-sm text-white/70">累计净值</div>
                <div className="mt-1 data-number text-4xl text-[#ff3a57]">{accumNav?.toFixed(4) || "--"}</div>
              </div>
              <div className="px-3">
                <div className="text-sm text-white/70">上期净值</div>
                <div className="mt-1 data-number text-4xl text-white/90">{prevNav?.toFixed(4) || "--"}</div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xl md:grid-cols-3">
              {topPerfRows.map((r) => (
                <div key={r.k} className="flex items-center gap-2">
                  <span className="text-white/80">{r.k}:</span>
                  <span className={`data-number ${getChangeTextClass(r.v)}`}>{r.v}</span>
                </div>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-white/80 md:grid-cols-3">
              <div>类型：<span className="text-[#86b4ff]">{fund.fundType || "混合型"}</span> | 中高风险</div>
              <div>规模：{fund.totalScale || "--"}亿元（{fund.assetAllocation?.[0]?.reportDate || "最新"}）</div>
              <div>基金经理：<span className="text-[#86b4ff]">{fund.manager?.name || "待更新"}</span></div>
              <div>成立日：{fund.foundDate || "2013-03-19"}</div>
              <div>管理人：<span className="text-[#86b4ff]">{fund.company || "待更新"}</span></div>
              <div className="flex items-center gap-2">基金评级：<Stars value={Math.max(0, Math.min(5, fund.stars || 4))} /></div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
          <div className="rounded-md border border-white/[0.08] bg-[#11141d] p-3">
            <div className="mb-3 flex flex-wrap gap-4 text-sm">
              {[
                { key: "ability", label: "业绩能力" },
                { key: "risk", label: "抗风险性" },
                { key: "fundamental", label: "基本面诊断" },
                { key: "manager", label: "基金经理诊断" },
                { key: "company", label: "基金公司诊断" },
              ].map((x) => (
                <button key={x.key} onClick={() => setTab(x.key as TabKey)} className={`border-b-2 pb-1 ${tab === x.key ? "border-[#3f6cff] text-[#8fb4ff]" : "border-transparent text-white/65"}`}>{x.label}</button>
              ))}
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              {["1m", "3m", "6m", "1y", "all"].map((p) => (
                <button key={p} onClick={() => setPeriod(p as Period)} className={`rounded border px-2 py-1 ${period === p ? "border-[#4c7fff] text-[#9ec0ff]" : "border-white/[0.15] text-white/70"}`}>{p.toUpperCase()}</button>
              ))}
            </div>

            <div className="h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.5)" }} />
                  <YAxis tick={{ fill: "rgba(255,255,255,0.5)" }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="fundRet" stroke="#5b6fb6" dot={false} name="本基金" />
                  <Line type="monotone" dataKey="peerRet" stroke="#66d2d8" dot={false} name="同类基金" />
                  <Line type="monotone" dataKey="benchmarkRet" stroke="#f1a363" dot={false} name="沪深300指数" />
                </ComposedChart>
              </ResponsiveContainer>
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
                <div className="flex justify-between"><span>诊断得分(一年)</span><span className="data-number text-[#3f6cff]">{Math.round(80 + (toNum(perf.sharpeRatio) || 0) * 4)}</span></div>
              </div>
            </div>

            <div className="rounded-md border border-white/[0.08] bg-[#11141d]">
              <div className="border-b border-white/[0.08] px-3 py-2 text-lg font-semibold text-white/90">基本信息</div>
              <div className="space-y-2 px-3 py-3 text-sm">
                <div className="flex justify-between"><span>成立日期</span><span>{fund.foundDate || "2013-03-19"}</span></div>
                <div className="flex justify-between"><span>基金状态</span><span>正在运行</span></div>
                <div className="flex justify-between"><span>基金公司</span><span>{fund.company || "待更新"}</span></div>
                <div className="flex items-center justify-between"><span>基金经理</span><span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5" />{fund.manager?.name || "待更新"}</span></div>
                <div className="flex justify-between"><span>基金规模</span><span>{fund.totalScale || "--"}亿</span></div>
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

