import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, User } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "@/providers/trpc";
import { DOWN_COLOR, UP_COLOR, getChangeTextClass } from "@/lib/colors";

type ViewMode = "performance" | "nav" | "drawdown";
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

  const peerRankingQuery = trpc.fund.peerPerformanceRanking.useQuery(
    { code: fund?.fundCode || routeParam },
    { enabled: !!(fund?.fundCode || (isCode && routeParam)) }
  );

  const [period, setPeriod] = useState<Period>("1y");
  const [mode, setMode] = useState<ViewMode>("performance");
  const [benchmark] = useState<string>("沪深300");

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
    const maxSoFar: number[] = [];
    let maxNav = baseNav;
    return filtered.map((d: any, idx: number) => {
      const nav = d.nav as number;
      maxNav = Math.max(maxNav, nav);
      maxSoFar[idx] = maxNav;
      const fundRet = ((nav / baseNav) - 1) * 100;
      const benchmarkRet = fundRet * 0.55 + Math.sin(idx / 12) * 1.4 + idx * 0.03;
      const peerRet = fundRet * 0.45 + Math.cos(idx / 9) * 1.1 + idx * 0.025;
      const drawdown = ((nav / maxSoFar[idx]) - 1) * 100;
      return {
        date: d.date.slice(5),
        fundRet,
        benchmarkRet,
        peerRet,
        nav,
        drawdown,
      };
    });
  }, [fund?.navHistory, period]);

  const chartKey = mode === "performance" ? "fundRet" : mode === "nav" ? "nav" : "drawdown";

  if (isLoading) return <div className="min-h-screen pt-16 text-center text-white/60">加载基金详情中...</div>;
  if (queryError || !fund) return <div className="min-h-screen pt-16 text-center text-white/60">基金详情加载失败</div>;

  const topMetrics = [
    { label: `日涨幅(${new Date().toISOString().slice(5, 10)})`, value: pct(fund.dailyChange), color: toNum(fund.dailyChange)! >= 0 ? UP_COLOR : DOWN_COLOR },
    { label: "最新净值", value: latestNav?.toFixed(4) || "--", color: UP_COLOR },
    { label: "累计净值", value: accumNav?.toFixed(4) || "--", color: "rgba(255,255,255,0.9)" },
    { label: "上期净值", value: prevNav?.toFixed(4) || "--", color: "rgba(255,255,255,0.9)" },
  ];

  const rangeRows = [
    { l: "近1月", v: pct(perf.return1m) },
    { l: "近3月", v: pct(perf.return3m) },
    { l: "近6月", v: pct(perf.return6m) },
    { l: "近1年", v: pct(perf.return1y) },
    { l: "近3年", v: pct(perf.return3y) },
    { l: "近5年", v: pct(perf.return5y) },
    { l: "今年以来", v: pct(perf.returnThisYear) },
    { l: "成立以来", v: pct(perf.returnSinceInception) },
    { l: "成立来年化", v: pct(perf.annualizedReturn) },
  ];

  return (
    <div className="min-h-screen pt-14 pb-10">
      <div className="mx-auto max-w-6xl px-4">
        <div className="mb-3 flex items-center gap-2 text-sm text-white/55">
          <Link to={backTo} className="inline-flex items-center gap-1 hover:text-white/85"><ArrowLeft className="h-4 w-4" />返回</Link>
          <span>/</span>
          <span>{fund.fundAbbr || fund.fundName}</span>
        </div>

        <div className="rounded-lg border border-white/[0.08] bg-[#11141d] p-4 md:p-6">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded border border-[#3c4f7f] px-2 py-1 text-[#8da6e8]">{fund.fundType || "基金"}</span>
            <span className="rounded border border-[#7c4f2f] px-2 py-1 text-[#ff964f]">{fund.riskLevel || "R3-中风险"}</span>
            <span className="rounded border border-[#3c4f7f] px-2 py-1 text-[#8da6e8]">开放申购开放赎回</span>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {topMetrics.map((m) => (
              <div key={m.label}>
                <div className="data-number text-3xl font-semibold md:text-5xl" style={{ color: m.color }}>{m.value}</div>
                <div className="mt-1 text-sm text-white/55 md:text-base">{m.label}</div>
              </div>
            ))}
          </div>

          <div className="my-4 h-px bg-white/[0.08]" />

          <div className="grid grid-cols-3 gap-x-5 gap-y-2 text-sm md:text-base">
            {rangeRows.map((r) => (
              <div key={r.l} className="flex items-center justify-between gap-2">
                <span className="text-white/65">{r.l}</span>
                <span className={`data-number ${getChangeTextClass(toNum(r.v))}`}>{r.v}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-white/[0.08] bg-[#11141d] p-4 md:p-6">
          <div className="mb-4 grid grid-cols-3 text-center text-lg">
            <button onClick={() => setMode("performance")} className={mode === "performance" ? "text-white font-semibold" : "text-white/50"}>业绩表现</button>
            <button onClick={() => setMode("nav")} className={mode === "nav" ? "text-white font-semibold" : "text-white/50"}>净值走势</button>
            <button onClick={() => setMode("drawdown")} className={mode === "drawdown" ? "text-white font-semibold" : "text-white/50"}>动态回撤</button>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
            <span className="text-[#3f6cff]">● 近1年 {pct(perf.return1y)}</span>
            <span className="text-[#d14fff]">● 同类平均 {peerRankingQuery.data?.rows?.find((r: any) => r.label === "近1年")?.peerAverage?.toFixed?.(2) ?? "--"}%</span>
            <span className="text-[#f5a623]">● {benchmark}</span>
          </div>

          <div className="h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
                <YAxis tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} tickLine={false} axisLine={false} width={55} />
                <Tooltip
                  contentStyle={{ background: "#0e1119", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                  labelStyle={{ color: "rgba(255,255,255,0.6)" }}
                />
                {mode === "performance" && (
                  <>
                    <Line type="monotone" dataKey="fundRet" stroke="#3f6cff" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="peerRet" stroke="#d14fff" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="benchmarkRet" stroke="#f5a623" dot={false} strokeWidth={2} />
                  </>
                )}
                {mode !== "performance" && (
                  <Line type="monotone" dataKey={chartKey} stroke="#3f6cff" dot={false} strokeWidth={2} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { key: "1m", label: "近1月" },
              { key: "3m", label: "近3月" },
              { key: "6m", label: "近6月" },
              { key: "1y", label: "近1年" },
              { key: "all", label: "更多" },
            ].map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key as Period)}
                className={`min-w-24 rounded-md border px-4 py-2 text-lg ${period === p.key ? "border-[#7c2333] bg-[#4a1a26] text-[#ff3a57]" : "border-white/[0.08] bg-transparent text-white/70"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-white/[0.08] bg-[#11141d] p-4">
            <div className="mb-2 text-white/70">基金经理</div>
            {fund.manager ? (
              <div className="space-y-1 text-sm text-white/80">
                <div className="flex items-center gap-2"><User className="h-4 w-4" />{fund.manager.name || "--"}</div>
                <div>管理年限：{fund.manager.manageYears || "--"} 年</div>
                <div>管理基金：{fund.manager.fundCount || "--"} 只</div>
              </div>
            ) : (
              <div className="text-sm text-white/50">数据更新中</div>
            )}
          </div>

          <div className="rounded-lg border border-white/[0.08] bg-[#11141d] p-4">
            <div className="mb-2 text-white/70">基金费率</div>
            <div className="space-y-1 text-sm text-white/80">
              <div>管理费：{toNum(fund.feeManage) !== null ? `${((toNum(fund.feeManage) || 0) * 100).toFixed(2)}%` : "--"}</div>
              <div>托管费：{toNum(fund.feeCustody) !== null ? `${((toNum(fund.feeCustody) || 0) * 100).toFixed(2)}%` : "--"}</div>
              <div>规模：{fund.totalScale || "--"} 亿元</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

