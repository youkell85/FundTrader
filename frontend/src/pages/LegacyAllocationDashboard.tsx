import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, RadarChart, PolarGrid, PolarAngleAxis, Radar, Tooltip } from 'recharts';
import { PieChart as PieIcon, TrendingUp, Gauge, AlertTriangle, Shield, Zap, Target, List, ChevronDown, ChevronRight } from 'lucide-react';
import { ASSET_CLASS_LABELS, GROUP_COLORS, REGIME_LABELS, SIGNAL_COLORS } from '@/types/allocation';
import type { MarketDataStatus } from '@/types/allocation';
import { useAllocationStore } from '@/store/allocationStore';
import { getMarketDataStatus } from '@/lib/api';
import { MOCK_DATA } from './mockData';
import DataFreshnessBar from '@/components/allocation/DataFreshnessBar';
import MarketRegimeCard from '@/components/allocation/MarketRegimeCard';
import CircuitBreakerGauge from '@/components/allocation/CircuitBreakerGauge';
import MacroSignalHeatmap from '@/components/allocation/MacroSignalHeatmap';
import BacktestPanel from '@/components/backtest/BacktestPanel';
import FundRankingPanel from '@/components/allocation/FundRankingPanel';
import RebalancePanel from '@/components/allocation/RebalancePanel';
import PlanManager from '@/components/allocation/PlanManager';
import VariantsComparisonPanel from '@/components/allocation/VariantsComparisonPanel';
import ExplainReportPanel from '@/components/allocation/ExplainReportPanel';
import WhatIfSimulatorPanel from '@/components/allocation/WhatIfSimulatorPanel';
import ShareSelectorPanel from '@/components/allocation/ShareSelectorPanel';
import CorrelationMatrixPanel from '@/components/allocation/CorrelationMatrixPanel';
import FeeAnalysisPanel from '@/components/allocation/FeeAnalysisPanel';
import PipelineHealthPanel from '@/components/allocation/PipelineHealthPanel';
import DualEnginePanel from '@/components/allocation/DualEnginePanel';

const TABS = ['总览', '市场', '战略', '战术', '压力', '蒙特', '基金', '选优', '再平衡', '回测', '管理', '三方案', '解释', '模拟', '份额', '相关性', '费率', '管线', '引擎'];
const GLABELS: any = { equity: '权益类', fixed_income: '固收类', alternative: '另类', cash_equiv: '现金类' };

function MT({ label, value, color, suffix }: any) {
  return <div className='rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-3'><div className='text-white/55 text-xs'>{label}</div><div className='data-number mt-1 text-lg font-medium' style={{ color }}>{value}{suffix || ''}</div></div>;
}

export default function AllocationDashboard() {
  const [tab, setTab] = useState(0);
  const [expandLog, setExpandLog] = useState(false);
  const [marketStatus, setMarketStatus] = useState<MarketDataStatus | null>(null);

  const storeState = useAllocationStore().state;
  const storeOutput = storeState?.output ?? null;
  const d = storeOutput || MOCK_DATA;
  const { saa, taa, funds, monte_carlo: mc, stress_tests: st, portfolio_metrics: pm, constraints } = d;

  // Poll market data status
  useEffect(() => {
    let active = true;
    const fetchStatus = () => {
      getMarketDataStatus().then(s => { if (active) setMarketStatus(s); }).catch(() => {});
    };
    fetchStatus();
    const timer = setInterval(fetchStatus, 60000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const pieData = Object.entries(saa.group_allocations).filter(([,v]) => v > 0).map(([k,v]) => ({ name: GLABELS[k] || k, value: v }));
  const stressData = [...st].sort((a,b) => a.impact - b.impact);

  return (
    <div className='min-h-screen pt-14 pb-20'>
      <div className='max-w-7xl mx-auto px-4 md:px-6'>
        <div className='pt-7 pb-2'>
          <h1 className='text-2xl md:text-3xl font-semibold text-white tracking-tight'>配置方案</h1>
          <div className='flex flex-wrap items-center gap-2 mt-2 text-sm text-white/45'>
            <span>引擎 {d.meta.engine_version}</span><span>·</span>
            <span>市场: <span className='text-[#16C784]'>{(REGIME_LABELS as any)[d.meta.regime]}</span></span><span>·</span>
            <span>{d.meta.generated_at.slice(0,16)}</span>
            {d.meta.circuit_breaker_triggered && <span className='text-[#EE6666] font-medium'>⚡熔断</span>}
          </div>
        </div>

        {/* Data Freshness Bar */}
        <DataFreshnessBar status={marketStatus} generatedAt={d.meta.generated_at} />

        <div className='flex gap-1 mb-6 border-b border-white/[0.06] overflow-x-auto'>
          {TABS.map((t,i) => (<button key={t} onClick={() => setTab(i)} className={`px-4 py-2.5 text-sm border-b-2 whitespace-nowrap ${tab===i ? 'border-[#3B6CFF] text-[#5AA9FF]' : 'border-transparent text-white/40 hover:text-white/65'}`}>{t}</button>))}
        </div>

        {/* TAB 0: OVERVIEW */}
        {tab === 0 && <div className='space-y-5'>
          <div className='grid grid-cols-2 md:grid-cols-6 gap-2 md:gap-3'>
            <MarketRegimeCard
              regime={d.meta.regime}
              regimeLabel={d.meta.regime_label}
              compositeScore={taa.composite_score}
              categorySummary={taa.category_summary}
              circuitBreakerTriggered={d.meta.circuit_breaker_triggered}
              regimePending={d.meta.regime_pending}
              regimePendingCount={d.meta.regime_pending_count}
              regimeConfirmed={d.meta.regime_is_confirmed}
              compact
            />
            <MT label='预期年化' value={`${pm.expected_return}%`} color='#16C784' />
            <MT label='波动率' value={`${pm.volatility}%`} color='#FAC858' />
            <MT label='最大回撤' value={`${pm.max_drawdown}%`} color='#EE6666' />
            <MT label='夏普比率' value={pm.sharpe.toFixed(2)} color='#5470C6' />
            <MT label='卡玛比率' value={pm.calmar.toFixed(2)} color='#91CC75' />
          </div>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-5'>
            <div className='liquid-glass p-4'>
              <h3 className='text-sm text-white/70 mb-3'><PieIcon className='w-4 h-4 inline mr-2' style={{color:'#3B6CFF'}} />资产配置</h3>
              <ResponsiveContainer width='100%' height={220}>
                <PieChart><Pie data={pieData} cx='50%' cy='50%' outerRadius={80} innerRadius={45} dataKey='value' label={({name,value}) => name+` `+value.toFixed(1)+`%`}>{pieData.map((_,i) => <Cell key={i} fill={Object.values(GROUP_COLORS)[i%4]} />)}</Pie><Tooltip /></PieChart>
              </ResponsiveContainer>
            </div>
            <div className='liquid-glass p-4'>
              <h3 className='text-sm text-white/70 mb-3'><Gauge className='w-4 h-4 inline mr-2' style={{color:'#FAC858'}} />风险预算瀑布</h3>
              <div className='space-y-2'>{Object.entries(saa.group_allocations).map(([k,v]) => (<div key={k}><div className='flex justify-between text-xs mb-1'><span className='text-white/50'>{GLABELS[k]||k}</span><span className='data-number text-white/70'>{v.toFixed(1)}%</span></div><div className='h-3 rounded-full bg-white/[0.04] overflow-hidden'><div className='h-full rounded-full' style={{width:`${v}%`, backgroundColor:(GROUP_COLORS as any)[k]||'#5470C6'}} /></div></div>))}</div>
            </div>
          </div>
          <div className='liquid-glass p-4'>
            <button onClick={() => setExpandLog(!expandLog)} className='flex items-center justify-between w-full text-sm text-white/70'><span><List className='w-4 h-4 inline mr-2' style={{color:'#9D7BFF'}} />配置审计日志</span>{expandLog ? <ChevronDown className='w-4 h-4' /> : <ChevronRight className='w-4 h-4' />}</button>
            {expandLog && (
              <div className='mt-3 space-y-1 text-xs text-white/45'>
                <div>画像：风险=平衡型，有效=平衡型</div>
                <div>市场状态：{d.meta.regime_label}{d.meta.regime_pending && !d.meta.regime_is_confirmed ? ` → 待确认：${d.meta.regime_pending}(${d.meta.regime_pending_count}/2)` : ''}（综合评分={taa.composite_score.toFixed(2)}）</div>
                <div className='text-[#16C784]'>战略配置：两层优化求解，权益中枢 {saa.equity_center}%</div>
                <div className='text-[#5AA9FF]'>战术调整：综合评分 {taa.composite_score>0?'+':''}{taa.composite_score.toFixed(2)}，超配 {taa.equity_adjustment}%{taa.fed_value != null && <span className='ml-2 text-[#5AA9FF] font-medium'>美联储模型={taa.fed_value}</span>}</div>
                <div>基金：{funds.length} 只映射完成</div>
                <div className='text-[#EE6666]'>压力测试：最坏 {stressData[0]?.scenario}({stressData[0]?.impact}%)</div>
                <div>蒙特卡洛：中位 {mc?.median_return || '暂无'}%，概率 {mc?.prob_positive || '暂无'}%</div>
              </div>
            )}
          </div>
          <div className='liquid-glass p-4 border border-[#FFB800]/10 bg-[#FFB800]/[0.03]'><p className='text-xs text-white/55 leading-relaxed'>{d.risk_disclaimer}</p></div>
        </div>}

        {/* TAB 1: MARKET INTELLIGENCE */}
        {tab === 1 && <div className='space-y-5'>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-5'>
            <MarketRegimeCard
              regime={d.meta.regime}
              regimeLabel={d.meta.regime_label}
              compositeScore={taa.composite_score}
              categorySummary={taa.category_summary}
              circuitBreakerTriggered={d.meta.circuit_breaker_triggered}
              regimePending={d.meta.regime_pending}
              regimePendingCount={d.meta.regime_pending_count}
              regimeConfirmed={d.meta.regime_is_confirmed}
            />
            <CircuitBreakerGauge
              triggered={d.meta.circuit_breaker_triggered}
              volRatio={marketStatus?.vol_ratio ?? null}
            />
          </div>
          <MacroSignalHeatmap
            signals={taa.signals}
            categorySummary={taa.category_summary}
          />
        </div>}

        {/* TAB 2: 战略配置 */}
        {tab === 2 && <div className='liquid-glass p-4 md:p-6'>
          <h3 className='text-sm text-white/70 mb-4'><Target className='w-4 h-4 inline mr-2' style={{color:'#EE6666'}} />战略资产配置</h3>
          <div className='overflow-x-auto'><table className='w-full text-xs'><thead><tr className='text-white/55 border-b border-white/[0.06]'>{['资产','权重','预期收益','波动率','风险贡献'].map(h => <th key={h} className='text-left py-2 px-2 font-normal'>{h}</th>)}</tr></thead>
            <tbody>{Object.entries(saa.allocations).filter(([,w]) => w > 0).sort((a,b) => b[1]-a[1]).map(([k,w]) => (<tr key={k} className='border-b border-white/[0.03] hover:bg-white/[0.02]'><td className='py-2 px-2 text-white/70'>{(ASSET_CLASS_LABELS as any)[k]||k}</td><td className='py-2 px-2 data-number text-white/80'>{w.toFixed(1)}%</td><td className='py-2 px-2 data-number text-white/45'>{(w*0.085).toFixed(1)}%</td><td className='py-2 px-2 data-number text-white/45'>{(({a_share_large:22,a_share_growth:30,a_share_value:20,a_share_small:28,hk_equity:24,us_equity:18,rate_bond:4,credit_bond:5,convertible:15,money_fund:0.3,gold:15,commodity:20,reits:12,cash:0.1}as any)[k]||10).toFixed(1)}%</td><td className='py-2 px-2 data-number text-[#FAC858]'>{(saa.risk_contributions[k]||0).toFixed(1)}%</td></tr>))}</tbody></table></div>
          <div className='mt-4 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-white/45'>分组: 权益{saa.group_allocations.equity?.toFixed(1)}% | 固收{saa.group_allocations.fixed_income?.toFixed(1)}% | 另类{saa.group_allocations.alternative?.toFixed(1)}% | 现金{saa.group_allocations.cash_equiv?.toFixed(1)}% {saa.glide_path_applied && '下滑曲线已应用'}</div>
        </div>}

        {/* TAB 3: 战术调整 */}
        {tab === 3 && <div className='space-y-5'>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-5'>
            <div className='liquid-glass p-4'><h3 className='text-sm text-white/70 mb-3'><TrendingUp className='w-4 h-4 inline mr-2' style={{color:'#9D7BFF'}} />宏观因子雷达图</h3>
              <ResponsiveContainer width='100%' height={280}>
                <RadarChart data={Object.entries(taa.category_summary).map(([,v]:any) => ({category:v.name,score:v.avg_score,fullMark:1}))}>
                  <PolarGrid stroke='rgba(255,255,255,0.08)' /><PolarAngleAxis dataKey='category' tick={{fill:'rgba(255,255,255,0.5)',fontSize:11}} /><Radar name='信号评分' dataKey='score' stroke='#3B6CFF' fill='#3B6CFF' fillOpacity={0.15} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className='liquid-glass p-4'><h3 className='text-sm text-white/70 mb-3'><Zap className='w-4 h-4 inline mr-2' style={{color:'#FAC858'}} />因子评分明细</h3>
              <div className='space-y-2'>{Object.entries(taa.category_summary).map(([key,v]:any) => (<div key={key} className='flex items-center gap-2'><span className='w-16 text-xs text-white/50'>{v.name}</span><div className='flex-1 h-2 rounded-full bg-white/[0.04]'><div className='h-full rounded-full' style={{width:`${Math.abs(v.avg_score)*100}%`, backgroundColor:(SIGNAL_COLORS as any)[key]||'#5470C6'}} /></div><span className='text-xs w-12 text-right text-white/70'>{v.interpretation}</span></div>))}</div>
              <div className='mt-4 p-3 rounded-lg bg-[#3B6CFF]/[0.06] border border-[#3B6CFF]/15'><div className='text-xs text-white/55'>综合评分: <span className='text-[#5AA9FF] data-number text-sm'>{taa.composite_score.toFixed(2)}</span> → 权益调整 <span className='data-number text-sm' style={{color:taa.equity_adjustment>0?'#16C784':'#EE6666'}}>{taa.equity_adjustment>0?'+':''}{taa.equity_adjustment}%</span></div></div>
              {taa.fed_value != null && (
                <div className='mt-3 p-3 rounded-lg bg-[#5AA9FF]/[0.06] border border-[#5AA9FF]/15'>
                  <div className='flex items-center gap-2 mb-1'><span className='text-[#5AA9FF] text-xs font-medium'>美联储模型</span><span className='text-[10px] px-1.5 py-0.5 rounded bg-[#5AA9FF]/10 text-[#5AA9FF]'>连续模型</span></div>
                  <div className='flex items-baseline gap-2'><span className='data-number text-xl font-semibold text-[#5AA9FF]'>{taa.fed_value}</span><span className='text-xs text-white/45'>{taa.fed_interpretation}</span></div>
                </div>
              )}
            </div>
          </div>
          <div className='liquid-glass p-4'><h3 className='text-sm text-white/70 mb-2'><Shield className='w-4 h-4 inline mr-2' style={{color:'#16C784'}} />美林时钟</h3><div className='text-sm text-white/60'>当前阶段: <span className='text-[#16C784] font-medium'>{taa.business_cycle.phase_name}</span> → 风格: <span className='text-[#5AA9FF]'>{taa.business_cycle.preferred_style==='growth'?'成长':taa.business_cycle.preferred_style==='value'?'价值':'均衡'}</span> → 行业: {taa.business_cycle.preferred_industries.join(', ')} → 久期: {taa.business_cycle.bond_duration}</div></div>
        </div>}

        {/* TAB 4: 压力测试 */}
        {tab === 4 && <div className='liquid-glass p-4 md:p-6'>
          <h3 className='text-sm text-white/70 mb-4'><AlertTriangle className='w-4 h-4 inline mr-2' style={{color:'#EE6666'}} />压力测试 (6历史情景)</h3>
          <ResponsiveContainer width='100%' height={320}>
            <BarChart data={stressData} layout='vertical' margin={{left:80,right:40}}><CartesianGrid stroke='rgba(255,255,255,0.05)' /><XAxis type='number' tick={{fill:'rgba(255,255,255,0.4)',fontSize:11}} unit='%' /><YAxis type='category' dataKey='scenario' tick={{fill:'rgba(255,255,255,0.55)',fontSize:12}} width={80} /><Tooltip formatter={(v:number) => [`${v}%`,'组合影响']} /><Bar dataKey='impact' radius={[0,4,4,0]}>{stressData.map((_,i) => <Cell key={i} fill={stressData[i].impact<0?'#EE6666':'#16C784'} />)}</Bar></BarChart>
          </ResponsiveContainer>
          <div className='mt-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-white/45'>{(() => { const w = [...st].sort((a,b) => a.impact-b.impact)[0]; return '最坏情景: '+w.scenario+' ('+w.impact+'%, 预计损失 '+w.max_loss.toLocaleString()+'元)'; })()}</div>
        </div>}

        {/* TAB 5: 蒙特卡洛 */}
        {tab === 5 && mc && <div className='liquid-glass p-4 md:p-6'>
          <h3 className='text-sm text-white/70 mb-4'><TrendingUp className='w-4 h-4 inline mr-2' style={{color:'#9D7BFF'}} />蒙特卡洛模拟 (1000次, 含跳跃扩散)</h3>
          <div className='grid grid-cols-2 md:grid-cols-4 gap-3 mb-4'>
            <MT label='中位收益' value={`${mc.median_return}%`} color='#16C784' />
            <MT label='P10-P90区间' value={`${mc.percentile_10}% ~ ${mc.percentile_90}%`} color='#FAC858' />
            <MT label='在险价值（95%）' value={`${mc.var_95}%`} color='#EE6666' />
            <MT label='正收益概率' value={`${mc.prob_positive}%`} color='#91CC75' />
          </div>
          <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
            <MT label='25%分位' value={`${mc.percentile_25}%`} color='#5470C6' />
            <MT label='75%分位' value={`${mc.percentile_75}%`} color='#5470C6' />
            <MT label='条件在险价值（95%）' value={`${mc.cvar_95}%`} color='#EE6666' />
            <MT label='最大回撤（95%分位）' value={`${mc.max_drawdown_95}%`} color='#FF6B35' />
          </div>
        </div>}

        {/* TAB 6: 基金 */}
        {tab === 6 && <div className='liquid-glass p-4 md:p-6'>
          <h3 className='text-sm text-white/70 mb-4'><List className='w-4 h-4 inline mr-2' style={{color:'#16C784'}} />基金明细 ({funds.length}只)</h3>
          <div className='overflow-x-auto'><table className='w-full text-xs'><thead><tr className='text-white/55 border-b border-white/[0.06]'>{['代码','名称','类型','权重','金额','角色','入选理由','评分'].map(h => <th key={h} className='text-left py-2 px-2 font-normal'>{h}</th>)}</tr></thead>
            <tbody>{funds.map((f: any) => (<tr key={f.code} className='border-b border-white/[0.03] hover:bg-white/[0.02]'><td className='py-2 px-2 data-number text-[#5AA9FF]'>{f.code}</td><td className='py-2 px-2 text-white/70'>{f.name}</td><td className='py-2 px-2 text-white/45'>{f.type}</td><td className='py-2 px-2 data-number text-white/80'>{f.weight}%</td><td className='py-2 px-2 data-number text-white/55'>{f.amount.toLocaleString()}</td><td className='py-2 px-2 text-white/55'>{f.role}</td><td className='py-2 px-2 text-white/40 max-w-[200px] truncate'>{f.reason}</td><td className='py-2 px-2 data-number text-[#FAC858]'>{f.score}</td></tr>))}</tbody></table></div>
          <div className='mt-4 space-y-1'>{constraints.map((c: any,i: number) => (<div key={i} className='flex items-center gap-2 text-xs'><span className={c.passed?'text-[#16C784]':'text-[#EE6666]'}>{c.passed?'✅':'❌'}</span><span className='text-white/45'>{c.rule}: {c.value} 限制 {c.limit}</span></div>))}</div>
        </div>}

        {tab === 7 && <FundRankingPanel />}

        {tab === 8 && <RebalancePanel />}

        {tab === 9 && <BacktestPanel />}

        {tab === 10 && (
          <div className="max-w-2xl mx-auto">
            <PlanManager />
          </div>
        )}

        {tab === 11 && <VariantsComparisonPanel />}

        {tab === 12 && <ExplainReportPanel />}

        {tab === 13 && <WhatIfSimulatorPanel />}

        {tab === 14 && <ShareSelectorPanel />}

        {tab === 15 && <CorrelationMatrixPanel />}

        {tab === 16 && <FeeAnalysisPanel />}

        {tab === 17 && <PipelineHealthPanel />}

        {tab === 18 && <DualEnginePanel />}
      </div>
    </div>
  );
}
