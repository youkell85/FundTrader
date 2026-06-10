import type { MarketDataStatus } from '@/types/allocation';

interface Props {
  status: MarketDataStatus | null;
  generatedAt: string;
}

function Dot({ active }: { active: boolean | null }) {
  if (active === null) return <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/20" />;
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${active ? 'bg-[#16C784]' : 'bg-[#EE6666]'}`} />;
}

export default function DataFreshnessBar({ status, generatedAt }: Props) {
  const macroOk = status?.macro_available ?? null;
  const volOk = status ? status.vol_ratio !== null : null;
  const rollingOk = status?.rolling_stats_available ?? null;
  const invalidCount = Object.keys(status?.invalid_assets || {}).length;
  const coverage = status?.rolling_coverage;
  const lastRefresh = status?.last_refresh ? status.last_refresh.slice(0, 16).replace('T', ' ') : null;
  const healthLabel = status?.health === 'healthy' ? '健康'
    : status?.health === 'degraded' ? '降级'
      : status?.health === 'critical' ? '异常'
        : null;
  const healthTone = status?.health === 'healthy' ? 'text-[#16C784]'
    : status?.health === 'critical' ? 'text-[#EE6666]'
      : 'text-[#FAC858]';

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] text-[11px] text-white/40 mb-3 overflow-x-auto">
      <span className="flex items-center gap-1"><Dot active={macroOk} />宏观</span>
      <span className="flex items-center gap-1"><Dot active={volOk} />波动率</span>
      <span className="flex items-center gap-1"><Dot active={rollingOk} />滚动统计</span>
      {coverage != null && <span className="whitespace-nowrap">覆盖率 {(coverage * 100).toFixed(0)}%</span>}
      {invalidCount > 0 && <span className="whitespace-nowrap text-[#FAC858]">无效资产 {invalidCount}</span>}
      {healthLabel && <span className={`whitespace-nowrap ${healthTone}`}>{healthLabel}</span>}
      <span className="ml-auto whitespace-nowrap">
        {status === null ? '连接中...' : lastRefresh ? `更新: ${lastRefresh}` : `生成: ${generatedAt.slice(0, 16).replace('T', ' ')}`}
      </span>
    </div>
  );
}
