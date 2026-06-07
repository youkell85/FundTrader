import { useState, useMemo } from 'react';
import {
  TrendingUp, Loader2, AlertCircle, Activity, BarChart3, Gauge,
  Clock, Wallet, Info, CheckCircle2, XCircle, Zap, Calendar,
} from 'lucide-react';
import { useAllocationData } from '@/hooks/useAllocationData';
import { useAllocationStore } from '@/store/allocationStore';
import PageHeader from '@/components/ui/PageHeader';
import BacktestPanel from '@/components/backtest/BacktestPanel';
import RebalancePanel from '@/components/allocation/RebalancePanel';
import EquityCurveChart from '@/components/backtest/EquityCurveChart';
import DrawdownChart from '@/components/backtest/DrawdownChart';
import RegimeTimeline from '@/components/backtest/RegimeTimeline';
import BacktestMetricsTable from '@/components/backtest/BacktestMetricsTable';
import { runAllocationBacktest } from '@/lib/api';
import type { BacktestRequest, BacktestResponse, BacktestMetrics, ComparisonMode } from '@/types/backtest';
import { MODE_LABELS, MODE_COLORS } from '@/types/backtest';
import type { ParsedDcaResult } from '@/lib/execution-plan';

/** 缺值兜底 */
function fmt(v: number | null | undefined, suffix?: string, digits = 1): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v.toFixed(digits)}${suffix || ''}`;
}
function fmtPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(2)}%`;
}

/** 状态徽章 */
function StatusBadge({ status, text }: { status: 'real' | 'demo' | 'degraded' | 'pending' | 'missing'; text: string }) {
  const styles = {
    real: 'border-[#16C784]/30 bg-[#16C784]/10 text-[#16C784]',
    demo: 'border-[#FFB800]/30 bg-[#FFB800]/10 text-[#FFB800]',
    degraded: 'border-[#EE6666]/30 bg-[#EE6666]/10 text-[#EE6666]',
    pending: 'border-[#5AA9FF]/30 bg-[#5AA9FF]/10 text-[#5AA9FF]',
    missing: 'border-white/[0.08] bg-white/[0.03] text-white/35',
  };
  return <span className={`rounded px-2 py-0.5 text-[11px] border ${styles[status]}`}>{text}</span>;
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' | 'neutral' }) {
  const color = tone === 'positive' ? 'text-[#16C784]' : tone === 'negative' ? 'text-[#EE6666]' : 'text-white/70';
  return (
    <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
      <div className="text-[10px] text-white/35">{label}</div>
      <div className={`mt-0.5 text-sm font-medium data-number ${color}`}>{value}</div>
    </div>
  );
}

/** 从 metrics 中提取最佳 KPI 摘要 */
function getPrimaryMetrics(metrics: Record<string, BacktestMetrics>): BacktestMetrics | null {
  const modes = Object.keys(metrics);
  if (modes.length === 0) return null;
  // Prefer saa_taa, then saa_only, then first available
  const primaryKey = modes.includes('saa_taa') ? 'saa_taa' : modes.includes('saa_only') ? 'saa_only' : modes[0];
  return metrics[primaryKey];
}

/** DCA 现金流图数据 */
function buildDcaCashflowData(curve: ParsedDcaResult['curve']) {
  if (!curve || curve.length === 0) return [];
  return curve.map(pt => ({
    date: pt.date,
    invested: pt.invested,
    value: pt.value,
    feeCost: pt.feeCost || 0,
    profit: pt.value - pt.invested,
  }));
}

export default function BacktestPage() {
  const { d, meta, isReal, isMock } = useAllocationData();
  const { state: storeState, dispatch } = useAllocationStore();

  // ─── 快速回测状态 ───
  const [backtestResult, setBacktestResult] = useState<BacktestResponse | null>(storeState.backtestResult || null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);

  // ─── DCA 回测结果（来自 ExecutePage 的 store）───
  const dcaResult: ParsedDcaResult | null = storeState.dcaResult || null;
  const dcaConfig = storeState.dcaConfig;

  // ─── 是否有任何回测结果 ───
  const hasAllocationBacktest = backtestResult != null && backtestResult.metrics != null;
  const hasDcaBacktest = dcaResult != null;
  const hasAnyResult = hasAllocationBacktest || hasDcaBacktest;

  // ─── 快速回测 handler ───
  const handleQuickBacktest = async () => {
    if (!isReal) {
      setBacktestError('当前为演示数据，请先生成真实配置方案');
      return;
    }
    const riskProfile = d?.user_profile?.risk_tolerance;
    if (!riskProfile) {
      setBacktestError('请先生成配置方案');
      return;
    }
    setBacktestLoading(true);
    setBacktestError(null);
    try {
      const req: BacktestRequest = {
        risk_profile: riskProfile,
        start_date: '2020-01-01',
        end_date: new Date().toISOString().slice(0, 10),
        initial_amount: d?.user_profile?.amount || 500000,
        rebalance_frequency: 'monthly',
        comparison_modes: ['saa_only', 'saa_taa'],
      };
      const res = await runAllocationBacktest(req);
      setBacktestResult(res);
      dispatch({ type: "SET_BACKTEST_RESULT", result: res });
    } catch (e: any) {
      setBacktestError(e?.message || '回测失败');
    } finally {
      setBacktestLoading(false);
    }
  };

  // ─── 派生数据 ───
  const primaryMetrics = hasAllocationBacktest ? getPrimaryMetrics(backtestResult!.metrics) : null;
  const dcaCashflowData = useMemo(() => buildDcaCashflowData(dcaResult?.curve), [dcaResult?.curve]);

  // 数据质量
  const dataQuality = backtestResult?.data_quality;
  const hasDataIssues = dataQuality && (dataQuality.assets_with_partial_history > 0 || dataQuality.missing_assets.length > 0);

  return (
    <div className="space-y-5">
      {/* ===== 报告头部 ===== */}
      <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold text-white tracking-tight">
              回测报告
            </h1>
            <p className="mt-1 text-xs text-white/45">
              组合定投与资产配置策略的历史回测表现
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isMock ? (
              <StatusBadge status="demo" text="演示数据" />
            ) : (
              <StatusBadge status="real" text="真实配置" />
            )}
            {hasAnyResult && <StatusBadge status="real" text="已回测" />}
            {!hasAnyResult && isReal && <StatusBadge status="pending" text="待回测" />}
            {meta.circuit_breaker_triggered && <StatusBadge status="degraded" text="断路器触发" />}
          </div>
        </div>

        {/* 元信息条 */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/40">
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3" />
            引擎 {meta.engine_version}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {meta.generated_at ? new Date(meta.generated_at).toLocaleString('zh-CN') : '—'}
          </span>
          <span className="flex items-center gap-1">
            <Gauge className="w-3 h-3" />
            市场: {meta.regime_label || meta.regime || '—'}
          </span>
          {dcaConfig && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              DCA: {dcaConfig.startDate} ~ {dcaConfig.endDate}
            </span>
          )}
        </div>
      </section>

      {/* ===== 快速操作区（无结果时） ===== */}
      {!hasAnyResult && (
        <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm text-white/70">
                {isMock
                  ? '当前为演示数据，回测功能不可用。请先生成真实配置方案。'
                  : '配置方案已就绪，可运行快速回测或自定义参数回测。'}
              </p>
              {backtestError && (
                <p className="text-xs text-[#EE6666] mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {backtestError}
                </p>
              )}
            </div>
            <button
              onClick={handleQuickBacktest}
              disabled={backtestLoading || !isReal}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#3B6CFF] text-white text-sm font-medium hover:bg-[#3B6CFF]/80 disabled:opacity-50 transition-colors"
            >
              {backtestLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              <TrendingUp className="w-4 h-4" />
              {backtestLoading ? '回测中...' : '运行快速回测'}
            </button>
          </div>
        </section>
      )}

      {/* ===== 资产配置回测结果 ===== */}
      {hasAllocationBacktest && (
        <>
          {/* KPI 摘要 */}
          <section>
            <h3 className="text-xs text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
              <BarChart3 className="w-3.5 h-3.5 text-[#16C784]" />
              回测摘要
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
              {primaryMetrics && (
                <>
                  <Kpi label="年化收益" value={fmtPct(primaryMetrics.annualized_return)} tone={primaryMetrics.annualized_return >= 0 ? 'positive' : 'negative'} />
                  <Kpi label="年化波动" value={fmtPct(primaryMetrics.annualized_volatility)} />
                  <Kpi label="最大回撤" value={fmtPct(primaryMetrics.max_drawdown)} tone="negative" />
                  <Kpi label="回撤天数" value={fmt(primaryMetrics.max_drawdown_duration_days, '天', 0)} />
                  <Kpi label="Sharpe" value={fmt(primaryMetrics.sharpe_ratio, '', 2)} />
                  <Kpi label="Sortino" value={fmt(primaryMetrics.sortino_ratio, '', 2)} />
                  <Kpi label="Calmar" value={fmt(primaryMetrics.calmar_ratio, '', 2)} />
                  <Kpi label="信息比率" value={fmt(primaryMetrics.information_ratio, '', 2)} />
                  <Kpi label="月胜率" value={fmt(primaryMetrics.monthly_win_rate, '%', 1)} />
                  <Kpi label="Alpha" value={primaryMetrics.alpha != null ? fmtPct(primaryMetrics.alpha) : '—'} />
                  <Kpi label="Beta" value={fmt(primaryMetrics.beta, '', 2)} />
                  <Kpi label="跟踪误差" value={primaryMetrics.tracking_error != null ? fmtPct(primaryMetrics.tracking_error) : '—'} />
                  <Kpi label="平均换手" value={fmt(primaryMetrics.avg_turnover, '%', 1)} />
                  <Kpi label="TAA增值" value={primaryMetrics.taa_value_added != null ? fmtPct(primaryMetrics.taa_value_added) : '—'} />
                </>
              )}
            </div>
          </section>

          {/* 数据质量提示 */}
          {hasDataIssues && (
            <div className="rounded-lg border border-[#FAC858]/20 bg-[#FAC858]/[0.05] px-4 py-3 flex items-start gap-2">
              <Info className="w-4 h-4 text-[#FAC858] shrink-0 mt-0.5" />
              <div className="text-xs text-[#FAC858]/80">
                <span className="font-medium">数据说明: </span>
                实际区间 {dataQuality!.earliest_common_date},
                {' '}{dataQuality!.assets_with_full_history}/{dataQuality!.assets_with_full_history + dataQuality!.assets_with_partial_history} 资产完整覆盖
                {dataQuality!.missing_assets.length > 0 && <>, 缺失: {dataQuality!.missing_assets.join(', ')}</>}
                ，总交易日 {dataQuality!.total_trading_days} 天。
              </div>
            </div>
          )}

          {/* 净值/回撤/月收益 图表 */}
          {backtestResult?.curves && Object.keys(backtestResult.curves).length > 0 && (
            <div className="space-y-4">
              <EquityCurveChart curves={backtestResult.curves} initialAmount={backtestResult.metrics?.saa_taa ? d?.user_profile?.amount || 500000 : 500000} />
              <DrawdownChart curves={backtestResult.curves} />
            </div>
          )}

          {/* 月度收益表 */}
          {backtestResult?.monthly_returns && Object.keys(backtestResult.monthly_returns).length > 0 && (
            <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 overflow-x-auto">
              <h3 className="text-xs text-white/40 uppercase tracking-wider mb-3">月度收益</h3>
              {Object.entries(backtestResult.monthly_returns).map(([mode, months]) => {
                const entries = Object.entries(months).sort(([a], [b]) => a.localeCompare(b));
                if (entries.length === 0) return null;
                return (
                  <div key={mode} className="mb-3">
                    <div className="text-[11px] font-medium mb-1" style={{ color: MODE_COLORS[mode as ComparisonMode] || '#fff' }}>
                      {MODE_LABELS[mode as ComparisonMode] || mode}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {entries.slice(-24).map(([month, ret]) => (
                        <div key={month} className="text-[10px] px-1.5 py-0.5 rounded border" style={{
                          borderColor: ret >= 0 ? 'rgba(22,199,132,0.2)' : 'rgba(238,102,102,0.2)',
                          backgroundColor: ret >= 0 ? 'rgba(22,199,132,0.05)' : 'rgba(238,102,102,0.05)',
                          color: ret >= 0 ? '#16C784' : '#EE6666',
                        }}>
                          {month}: {ret >= 0 ? '+' : ''}{ret.toFixed(2)}%
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {/* 绩效指标对比表 */}
          {backtestResult?.metrics && Object.keys(backtestResult.metrics).length > 0 && (
            <BacktestMetricsTable metrics={backtestResult.metrics} />
          )}

          {/* 市场体制时间线 */}
          {backtestResult?.regime_history && backtestResult.regime_history.length > 0 && (
            <RegimeTimeline regimeHistory={backtestResult.regime_history} attribution={backtestResult.attribution || {}} />
          )}

          {/* Benchmark 状态 */}
          {backtestResult?.metrics && (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
              <h3 className="text-xs text-white/40 uppercase tracking-wider mb-2">基准数据状态</h3>
              <div className="space-y-1 text-xs text-white/35">
                {(['equal_weight', 'sixty_forty'] as ComparisonMode[]).map(mode => {
                  const hasMode = backtestResult.metrics[mode] != null;
                  return (
                    <div key={mode} className="flex items-center gap-2">
                      {hasMode ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#16C784]" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-white/25" />
                      )}
                      <span>{MODE_LABELS[mode]}: {hasMode ? '可用' : '未计算'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ===== DCA 定投回测结果 ===== */}
      {hasDcaBacktest && (
        <>
          <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs text-white/40 uppercase tracking-wider flex items-center gap-2">
                <Wallet className="w-3.5 h-3.5 text-[#5AA9FF]" />
                定投回测结果
              </h3>
              <StatusBadge status="real" text="已回测" />
            </div>

            {/* DCA KPI */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-4">
              <Kpi label="总投入" value={`${(dcaResult!.totalInvested / 10000).toFixed(1)}万`} />
              <Kpi label="期末市值" value={`${(dcaResult!.finalValue / 10000).toFixed(1)}万`} />
              <Kpi label="总收益" value={fmtPct(dcaResult!.totalReturn)} tone={dcaResult!.totalReturn >= 0 ? 'positive' : 'negative'} />
              <Kpi label="年化收益" value={fmtPct(dcaResult!.annualizedReturn)} tone={dcaResult!.annualizedReturn >= 0 ? 'positive' : 'negative'} />
              <Kpi label="最大回撤" value={fmtPct(dcaResult!.maxDrawdown)} tone="negative" />
              <Kpi label="Sharpe" value={fmt(dcaResult!.sharpeRatio, '', 2)} />
            </div>

            {/* DCA 现金流曲线 */}
            {dcaCashflowData.length > 0 ? (
              <div className="space-y-3">
                <div className="text-[11px] text-white/30">
                  策略: {dcaResult!.strategy} · 频率: {dcaResult!.frequency}
                  {dcaResult!.feeCost > 0 && <> · 总费率成本: {fmtPct(dcaResult!.feeCost)}</>}
                </div>

                {/* 简化的现金流表格（最近10期 + 首尾） */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-white/40 border-b border-white/[0.06]">
                        <th className="text-left py-1.5 px-2 font-normal">日期</th>
                        <th className="text-right py-1.5 px-2 font-normal">累计投入</th>
                        <th className="text-right py-1.5 px-2 font-normal">市值</th>
                        <th className="text-right py-1.5 px-2 font-normal">盈亏</th>
                        <th className="text-right py-1.5 px-2 font-normal">收益率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* 首行 */}
                      {dcaCashflowData.length > 0 && (
                        <tr className="border-b border-white/[0.03]">
                          <td className="py-1.5 px-2 text-white/55">{dcaCashflowData[0].date}</td>
                          <td className="py-1.5 px-2 text-right data-number text-white/55">{dcaCashflowData[0].invested.toLocaleString()}</td>
                          <td className="py-1.5 px-2 text-right data-number text-white/55">{dcaCashflowData[0].value.toLocaleString()}</td>
                          <td className="py-1.5 px-2 text-right data-number" style={{ color: dcaCashflowData[0].profit >= 0 ? '#16C784' : '#EE6666' }}>
                            {dcaCashflowData[0].profit >= 0 ? '+' : ''}{dcaCashflowData[0].profit.toLocaleString()}
                          </td>
                          <td className="py-1.5 px-2 text-right data-number" style={{ color: dcaCashflowData[0].profit >= 0 ? '#16C784' : '#EE6666' }}>
                            {dcaCashflowData[0].invested > 0 ? fmt((dcaCashflowData[0].profit / dcaCashflowData[0].invested) * 100, '%') : '—'}
                          </td>
                        </tr>
                      )}
                      {/* 中间省略 */}
                      {dcaCashflowData.length > 2 && (
                        <tr className="border-b border-white/[0.03]">
                          <td colSpan={5} className="py-1 px-2 text-center text-white/20 text-[10px]">
                            ... 共 {dcaCashflowData.length} 期 ...
                          </td>
                        </tr>
                      )}
                      {/* 末行 */}
                      {dcaCashflowData.length > 1 && (
                        <tr className="border-b border-white/[0.03]">
                          <td className="py-1.5 px-2 text-white/70 font-medium">{dcaCashflowData[dcaCashflowData.length - 1].date}</td>
                          <td className="py-1.5 px-2 text-right data-number text-white/70">{dcaCashflowData[dcaCashflowData.length - 1].invested.toLocaleString()}</td>
                          <td className="py-1.5 px-2 text-right data-number text-white/70">{dcaCashflowData[dcaCashflowData.length - 1].value.toLocaleString()}</td>
                          <td className="py-1.5 px-2 text-right data-number font-medium" style={{ color: dcaCashflowData[dcaCashflowData.length - 1].profit >= 0 ? '#16C784' : '#EE6666' }}>
                            {dcaCashflowData[dcaCashflowData.length - 1].profit >= 0 ? '+' : ''}{dcaCashflowData[dcaCashflowData.length - 1].profit.toLocaleString()}
                          </td>
                          <td className="py-1.5 px-2 text-right data-number font-medium" style={{ color: dcaCashflowData[dcaCashflowData.length - 1].profit >= 0 ? '#16C784' : '#EE6666' }}>
                            {dcaCashflowData[dcaCashflowData.length - 1].invested > 0 ? fmt((dcaCashflowData[dcaCashflowData.length - 1].profit / dcaCashflowData[dcaCashflowData.length - 1].invested) * 100, '%') : '—'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="py-4 text-center">
                <p className="text-sm text-white/35">现金流曲线数据缺失</p>
                <p className="text-[11px] text-white/25 mt-1">后端未返回 curve 字段</p>
              </div>
            )}
          </section>
        </>
      )}

      {/* ===== 无数据提示 ===== */}
      {!hasAnyResult && isReal && !backtestLoading && (
        <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="text-xs text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-[#73C0DE]" />
            回测说明
          </h3>
          <div className="space-y-2 text-xs text-white/35 leading-relaxed">
            <p>本页支持两种回测模式：</p>
            <p><strong className="text-white/50">1. 资产配置策略回测</strong>：基于 SAA/TAA 权重，模拟历史调仓再平衡表现。支持对比纯 SAA、SAA+TAA、等权、60/40 等多种策略。</p>
            <p><strong className="text-white/50">2. 定投回测</strong>：在"执行计划"页配置定投策略（固定金额/估值区间/均线偏离/下跌加倍），运行回测后结果将显示在本页。</p>
            <p className="mt-2 text-white/25">点击上方"运行快速回测"开始使用默认参数，或在下方配置面板自定义参数。</p>
          </div>
        </section>
      )}

      {/* ===== 数据质量与基准状态 ===== */}
      {hasAnyResult && (
        <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="text-xs text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Info className="w-3.5 h-3.5 text-[#73C0DE]" />
            数据质量与基准状态
          </h3>

          {/* 资产配置回测数据质量 */}
          {hasAllocationBacktest && backtestResult!.data_quality && (
            <div className="space-y-3">
              {/* 核心指标行 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
                  <div className="text-[10px] text-white/30">回测区间</div>
                  <div className="mt-0.5 text-xs font-medium text-white/70 data-number">
                    {backtestResult!.data_quality.earliest_common_date || '—'}
                  </div>
                </div>
                <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
                  <div className="text-[10px] text-white/30">回测天数</div>
                  <div className="mt-0.5 text-xs font-medium text-white/70 data-number">
                    {backtestResult!.data_quality.total_trading_days != null
                      ? `${backtestResult!.data_quality.total_trading_days} 天`
                      : '—'}
                  </div>
                </div>
                <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
                  <div className="text-[10px] text-white/30">资产覆盖率</div>
                  <div className="mt-0.5 text-xs font-medium data-number"
                    style={{
                      color: backtestResult!.data_quality.macro_coverage_pct != null && backtestResult!.data_quality.macro_coverage_pct >= 90
                        ? '#16C784'
                        : backtestResult!.data_quality.macro_coverage_pct != null && backtestResult!.data_quality.macro_coverage_pct >= 70
                          ? '#FAC858'
                          : '#EE6666'
                    }}
                  >
                    {backtestResult!.data_quality.macro_coverage_pct != null
                      ? `${backtestResult!.data_quality.macro_coverage_pct.toFixed(1)}%`
                      : '—'}
                  </div>
                </div>
                <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
                  <div className="text-[10px] text-white/30">完整 / 部分资产</div>
                  <div className="mt-0.5 text-xs font-medium text-white/70 data-number">
                    {backtestResult!.data_quality.assets_with_full_history != null && backtestResult!.data_quality.assets_with_partial_history != null
                      ? `${backtestResult!.data_quality.assets_with_full_history} / ${backtestResult!.data_quality.assets_with_partial_history}`
                      : '—'}
                  </div>
                </div>
              </div>

              {/* 缺失资产 */}
              <div>
                <div className="text-[10px] text-white/30 mb-1.5">缺失资产</div>
                {backtestResult!.data_quality.missing_assets.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {backtestResult!.data_quality.missing_assets.map((asset, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.02] border border-white/[0.04] text-white/40">
                        {asset}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-[10px] text-white/25">无缺失资产</span>
                )}
              </div>

              {/* 基准状态 */}
              <div>
                <div className="text-[10px] text-white/30 mb-1.5">基准状态</div>
                <div className="space-y-1 text-xs">
                  {(['equal_weight', 'sixty_forty'] as ComparisonMode[]).map(mode => {
                    const hasMode = backtestResult.metrics[mode] != null;
                    return (
                      <div key={mode} className="flex items-center gap-2">
                        {hasMode ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#16C784] shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-white/25 shrink-0" />
                        )}
                        <span className={hasMode ? 'text-white/50' : 'text-white/25'}>
                          {MODE_LABELS[mode]}: {hasMode ? '可用' : '暂无基准数据'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 数据降级说明 */}
              {(backtestResult!.data_quality.assets_with_partial_history > 0 || backtestResult!.data_quality.missing_assets.length > 0 || (backtestResult!.data_quality.macro_coverage_pct != null && backtestResult!.data_quality.macro_coverage_pct < 90)) && (
                <div className="rounded-md border border-[#FAC858]/15 bg-[#FAC858]/[0.03] px-3 py-2">
                  <div className="text-[10px] text-[#FAC858]/70">
                    <span className="font-medium">数据降级说明: </span>
                    {backtestResult!.data_quality.assets_with_partial_history > 0 && `${backtestResult!.data_quality.assets_with_partial_history} 只资产使用部分历史数据`}
                    {backtestResult!.data_quality.missing_assets.length > 0 && `；${backtestResult!.data_quality.missing_assets.length} 只资产缺失`}
                    {backtestResult!.data_quality.macro_coverage_pct != null && backtestResult!.data_quality.macro_coverage_pct < 90 && `；宏观因子覆盖率 ${backtestResult!.data_quality.macro_coverage_pct.toFixed(1)}%`}
                    。结果仅供研究参考。
                  </div>
                </div>
              )}
            </div>
          )}

          {/* DCA 回测数据质量 */}
          {hasDcaBacktest && (
            <div className="space-y-1.5 text-xs text-white/35 mt-3 pt-3 border-t border-white/[0.04]">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#16C784]" />
                <span>定投策略: {dcaResult!.strategy} · 频率: {dcaResult!.frequency}</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#16C784]" />
                <span>费率成本: {fmtPct(dcaResult!.feeCost)}</span>
              </div>
              {!dcaResult!.curve && (
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-[#FFB800]" />
                  <span>现金流明细缺失 — 后端未返回 curve 字段</span>
                </div>
              )}
            </div>
          )}

          {/* 演示数据提示 */}
          {isMock && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/[0.04]">
              <XCircle className="w-3.5 h-3.5 text-[#FFB800]" />
              <span className="text-xs text-white/35">当前基于演示数据回测，结果仅供展示</span>
            </div>
          )}
        </section>
      )}

      {/* ===== 回测配置面板（始终显示） ===== */}
      {!hasAllocationBacktest && <BacktestPanel />}

      {/* ===== 再平衡面板 ===== */}
      <RebalancePanel />
    </div>
  );
}
