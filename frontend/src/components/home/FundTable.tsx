import { Link } from "react-router";
import { TrendingUp, TrendingDown, Star, Loader2, Trash2, Plus, AlertCircle, RefreshCw } from "lucide-react";
import { RISK_COLOR, POSITIVE_METRIC_COLOR, getChangeTextClass } from "@/lib/colors";

const typeLabels: Record<string, string> = {
  equity: "股票型",
  hybrid: "混合型",
  bond: "债券型",
  index: "指数型",
  etf: "ETF",
  qdii: "QDII",
  money: "货币型",
  fof: "FOF",
  reits: "REITs",
};

interface FundTableProps {
  paginatedFunds: any[];
  listLoading: boolean;
  listIsError?: boolean;
  listError?: string | null;
  listDegraded?: boolean;
  listMissingReason?: string | null;
  isLocalFilterLimited?: boolean;
  showXinjihui: boolean;
  showWatchlistOnly: boolean;
  hasSearch: boolean;
  totalPages: number;
  page: number;
  onPageChange: (page: number) => void;
  onAddFund: (code: string) => void;
  onRemoveFund: (code: string) => void;
  onRetry?: () => void;
}

function MetricSkeleton() {
  return <span className="inline-block w-12 h-4 rounded bg-white/[0.08] animate-pulse" />;
}

export default function FundTable({
  paginatedFunds,
  listLoading,
  listIsError,
  listError,
  listDegraded,
  listMissingReason,
  isLocalFilterLimited,
  showXinjihui,
  showWatchlistOnly,
  hasSearch,
  totalPages,
  page,
  onPageChange,
  onAddFund,
  onRemoveFund,
  onRetry,
}: FundTableProps) {
  return (
    <section className="px-4 md:px-6 max-w-7xl mx-auto">
      <div className="surface overflow-hidden">
        <div className="hidden md:grid md:grid-cols-[minmax(260px,2fr)_repeat(5,minmax(92px,1fr))_minmax(150px,1fr)] gap-3 px-5 py-3 text-xs text-white/50 font-medium border-b border-white/[0.06] items-center">
          <div>基金产品</div>
          <div className="text-right">净值</div>
          <div className="text-right">日涨跌</div>
          <div className="text-right">近1年</div>
          <div className="text-right">夏普</div>
          <div className="text-right">回撤</div>
          <div>类型/标签</div>
        </div>

        {listIsError ? (
          <div className="p-8 text-center">
            <div className="flex items-center justify-center gap-2 text-[#F5384B] text-sm mb-2">
              <AlertCircle className="w-4 h-4" />请求失败: {listError || "未知错误"}
            </div>
            {onRetry && (
              <button
                onClick={onRetry}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-white/70 bg-white/[0.06] hover:bg-white/[0.10] transition-colors"
              >
                <RefreshCw className="w-3 h-3" />重试
              </button>
            )}
          </div>
        ) : listDegraded && paginatedFunds.length === 0 ? (
          <div className="p-8 text-center">
            <div className="flex items-center justify-center gap-2 text-[#FFB800] text-sm mb-2">
              <AlertCircle className="w-4 h-4" />数据降级: {listMissingReason || "基础数据暂不可用"}
            </div>
            <p className="text-xs text-white/40">后端数据源响应超时，数据正在后台预热中。</p>
            {onRetry && (
              <button
                onClick={onRetry}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-white/70 bg-white/[0.06] hover:bg-white/[0.10] transition-colors"
              >
                <RefreshCw className="w-3 h-3" />重试
              </button>
            )}
          </div>
        ) : listDegraded && paginatedFunds.length > 0 ? (
          <div className="px-5 py-2 text-center">
            <p className="text-[#FFB800] text-xs">
              <AlertCircle className="w-3 h-3 inline mr-1" />
              数据降级中，部分数据可能不完整。{listMissingReason && `原因: ${listMissingReason}`}
            </p>
          </div>
        ) : null}

        {/* 本地过滤提示：快照路径不支持 fundType/company/riskLevel/watchlist，仅过滤前 100 条 */}
        {isLocalFilterLimited && !listLoading && !listIsError && paginatedFunds.length > 0 && (
          <div className="px-5 py-1.5 text-center border-b border-[#FFB800]/20 bg-[#FFB800]/5">
            <p className="text-[#FFB800] text-[11px]">
              当前处于轻量模式，基金类型/公司/风险/自选筛选仅作用于已加载的前 100 条基金，结果可能不完整。完整筛选将在风险指标加载后生效。
            </p>
          </div>
        )}

        {listLoading ? (
          <div className="p-8 text-center text-white/50 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />加载中...
          </div>
        ) : paginatedFunds.length === 0 && !listDegraded ? (
          isLocalFilterLimited ? (
            <div className="p-8 text-center">
              <div className="flex items-center justify-center gap-2 text-[#FFB800] text-sm mb-2">
                <AlertCircle className="w-4 h-4" />轻量模式筛选举措
              </div>
              <p className="text-xs text-white/60 max-w-md mx-auto">
                当前处于轻量模式，类型/公司/风险/自选筛选仅作用于已加载的前 100 条基金，结果可能不完整。请稍后重试或等待完整指标加载。
              </p>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-white/70 bg-white/[0.06] hover:bg-white/[0.10] transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />重试
                </button>
              )}
            </div>
          ) : (
            <div className="p-8 text-center text-white/50">
              {showXinjihui ? "暂无鑫基荟产品" : showWatchlistOnly ? "暂无自选基金" : "暂无基金数据"}
            </div>
          )
        ) : !listLoading && paginatedFunds.length > 0 ? (
          paginatedFunds.map((fund: any) => {
            const perf = fund.performance;
            const dailyChange = parseFloat(fund.dailyChange || "0");
            const return1y = parseFloat(perf?.return1y || "0");
            const maxDD = perf?.maxDrawdown === "—" ? null : parseFloat(perf?.maxDrawdown || "0");
            const sharpe = perf?.sharpeRatio === "—" ? null : parseFloat(perf?.sharpeRatio || "0");
            const isWatchlistFund = fund.source === "watchlist";
            return (
              <div key={fund.id} className="border-b border-white/[0.03] hover:bg-white/[0.04] transition-all group cursor-pointer relative">
                <Link to={`/${fund.fundCode}`} className="hidden md:grid md:grid-cols-[minmax(260px,2fr)_repeat(5,minmax(92px,1fr))_minmax(150px,1fr)] gap-3 px-5 py-3.5 text-sm items-center">
                  <div className="min-w-0">
                    <div className="text-white font-medium text-sm flex items-center gap-1">
                      {fund.fundAbbr || fund.fundName}
                      {isWatchlistFund && <Star className="w-3 h-3 text-[#FFB800] fill-[#FFB800]" />}
                    </div>
                    <div className="text-white/50 text-xs mt-0.5 flex items-center gap-1.5">
                      <span className="data-number">{fund.fundCode}</span>
                      <span>{fund.manager?.name}</span>
                      <span>{fund.company}</span>
                    </div>
                  </div>
                  <div className="text-right data-number text-white/80">{fund.nav}</div>
                  <div className={`text-right data-number font-medium ${getChangeTextClass(dailyChange)}`}>
                    <span className="inline-flex items-center gap-0.5">
                      {dailyChange >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {dailyChange >= 0 ? "+" : ""}{dailyChange.toFixed(2)}%
                    </span>
                  </div>
                  <div className={`text-right data-number ${getChangeTextClass(return1y)}`}>
                    {perf?.return1y === "—" || perf?.return1y === undefined ? <MetricSkeleton /> : `${return1y >= 0 ? "+" : ""}${perf?.return1y}%`}
                  </div>
                  <div className="text-right data-number" style={{ color: POSITIVE_METRIC_COLOR }}>
                    {sharpe !== null ? sharpe.toFixed(2) : <MetricSkeleton />}
                  </div>
                  <div className="text-right data-number" style={{ color: RISK_COLOR }}>
                    {maxDD !== null ? `${maxDD.toFixed(2)}%` : <MetricSkeleton />}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="px-2 py-0.5 rounded text-xs bg-white/[0.05] text-white/60">{typeLabels[fund.fundType] || fund.fundType}</span>
                    {(fund.tags || []).slice(0, 2).map((tag: string) => (
                      <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#3B6CFF]/10 text-[#5AA9FF] border border-[#3B6CFF]/20">{tag}</span>
                    ))}
                  </div>
                </Link>

                {hasSearch && !isWatchlistFund && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onAddFund(fund.fundCode);
                    }}
                    className="absolute top-2 right-10 z-20 w-7 h-7 rounded-md bg-[#16C784]/15 text-[#16C784] hover:bg-[#16C784]/25 flex items-center justify-center transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100"
                    title="加入自选"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}

                {isWatchlistFund && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onRemoveFund(fund.fundCode);
                    }}
                    className="absolute top-2 right-2 z-20 w-7 h-7 rounded-md bg-[#F5384B]/10 text-[#F5384B] hover:bg-[#F5384B]/20 flex items-center justify-center transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100"
                    title="移出自选"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })
        ) : null}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 mt-6">
          <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1} className="px-3 py-1.5 rounded-lg text-sm text-white/50 hover:text-white disabled:opacity-30">上一页</button>
          <span className="text-white/40 text-sm data-number">{page} / {totalPages}</span>
          <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className="px-3 py-1.5 rounded-lg text-sm text-white/50 hover:text-white disabled:opacity-30">下一页</button>
        </div>
      )}
    </section>
  );
}
