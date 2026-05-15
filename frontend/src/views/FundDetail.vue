<template>
  <div class="min-h-screen pb-24 bg-bg-DEFAULT">
    <!-- 头部 -->
    <header class="sticky top-0 z-40 glass-header">
      <div class="flex items-center gap-3 px-4 py-3">
        <button @click="router.back()" class="p-1.5 rounded-lg hover:bg-white/5 transition-colors">
          <ChevronLeft class="w-5 h-5 text-text-secondary" />
        </button>
        <div class="flex-1 min-w-0">
          <h1 class="text-base font-semibold text-text-primary truncate">{{ fundName }}</h1>
          <p class="text-xs text-text-muted">{{ code }}</p>
        </div>
        <span class="text-xs px-2.5 py-1 rounded-full border font-medium" :class="signalClass">{{ analysis.signal || '评估中' }}</span>
      </div>
      <div class="flex items-end justify-between px-4 pb-4">
        <div>
          <p class="text-3xl font-bold tracking-tight" :class="navColor">{{ formatNav(analysis.nav) }}</p>
          <p class="text-[11px] text-text-muted mt-0.5">{{ analysis.nav_date || '--' }}</p>
        </div>
        <div class="text-right">
          <p class="text-xl font-semibold" :class="dayColor">{{ formatDayGrowth(analysis.day_growth) }}</p>
          <p class="text-[11px] text-text-muted">日涨跌幅</p>
        </div>
      </div>
    </header>

    <!-- 业绩表现 -->
    <section class="px-4 pt-3">
      <div class="glass-card p-4">
        <h3 class="text-sm font-medium text-text-primary mb-3">业绩表现</h3>
        <div class="grid grid-cols-3 gap-3">
          <div v-for="item in perfItems" :key="item.label" class="text-center p-2.5 rounded-lg bg-white/[0.03]">
            <p class="text-[11px] text-text-muted mb-1">{{ item.label }}</p>
            <p class="text-sm font-bold" :class="item.val >= 0 ? 'text-rise' : 'text-fall'">{{ formatPct(item.val) }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 净值走势 -->
    <section class="px-4 pt-3">
      <div class="glass-card p-4">
        <h3 class="text-sm font-medium text-text-primary mb-3">净值走势</h3>
        <ChartWrapper :option="navChartOption" height="200px" />
        <p v-if="!analysis.nav_data?.length" class="text-center text-xs text-text-muted py-8">暂无净值历史数据</p>
      </div>
    </section>

    <!-- 风险指标 -->
    <section class="px-4 pt-3">
      <div class="glass-card p-4">
        <h3 class="text-sm font-medium text-text-primary mb-3">风险指标</h3>
        <div class="grid grid-cols-2 gap-3">
          <div v-for="item in riskItems" :key="item.label" class="p-3 rounded-lg bg-white/[0.03]">
            <p class="text-[11px] text-text-muted">{{ item.label }}</p>
            <p class="text-base font-bold text-text-primary mt-1">{{ item.val !== null ? item.val : '--' }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 配置价值评估 + 雷达图 -->
    <section class="px-4 pt-3">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div class="glass-card p-4">
          <h3 class="text-sm font-medium text-text-primary mb-3">配置价值评估</h3>
          <div class="flex items-center gap-4 mb-3">
            <div class="relative w-16 h-16">
              <svg class="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                <path class="text-white/5" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" stroke-width="3" />
                <path class="text-gold" :stroke-dasharray="`${(analysis.score || 50)}, 100`" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
              </svg>
              <span class="absolute inset-0 flex items-center justify-center text-sm font-bold text-gold">{{ analysis.score || '--' }}</span>
            </div>
            <div class="flex-1">
              <p class="text-xs text-text-secondary">信心指数</p>
              <p class="text-lg font-semibold" :class="signalClass.split(' ')[0]">{{ analysis.signal || '--' }}</p>
              <p class="text-[11px] text-text-muted">置信度 {{ formatPct((analysis.confidence || 0) * 100) }}</p>
            </div>
          </div>
          <ul class="space-y-1.5">
            <li v-for="(reason, i) in (analysis.reasons || [])" :key="i" class="text-xs text-text-secondary flex gap-2">
              <span class="text-gold shrink-0">{{ i + 1 }}.</span><span>{{ reason }}</span>
            </li>
          </ul>
          <p v-if="!(analysis.reasons?.length)" class="text-xs text-text-muted mt-2">暂无评估数据</p>
        </div>
        <div class="glass-card p-4">
          <h3 class="text-sm font-medium text-text-primary mb-1">多维评估</h3>
          <ChartWrapper :option="radarChartOption" height="220px" />
        </div>
      </div>
    </section>

    <!-- 重仓持股 -->
    <section class="px-4 pt-3">
      <div class="glass-card p-4">
        <h3 class="text-sm font-medium text-text-primary mb-3">重仓持股</h3>
        <div v-if="analysis.holdings?.length" class="space-y-3">
          <div v-for="(h, i) in analysis.holdings" :key="i" class="flex items-center gap-3">
            <span class="text-xs text-text-muted w-5">{{ i + 1 }}</span>
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between mb-1">
                <span class="text-xs text-text-primary truncate">{{ h.name }}</span>
                <span class="text-xs font-medium text-gold">{{ h.ratio }}%</span>
              </div>
              <div class="progress-bar">
                <div class="progress-bar-fill bg-gold/60" :style="{ width: Math.min(h.ratio * 2, 100) + '%' }" />
              </div>
            </div>
          </div>
        </div>
        <div v-else class="flex flex-col items-center py-6">
          <Briefcase class="w-8 h-8 text-text-dim mb-2" />
          <p class="text-xs text-text-secondary">暂无持仓数据</p>
          <p class="text-[10px] text-text-muted mt-1">持仓数据按季度披露，可能存在延迟</p>
        </div>
      </div>
    </section>

    <!-- 基金经理 -->
    <section class="px-4 pt-3">
      <div class="glass-card p-4">
        <h3 class="text-sm font-medium text-text-primary mb-3">基金经理</h3>
        <div v-if="analysis.manager && analysis.manager.name" class="flex items-start gap-3">
          <div class="w-12 h-12 rounded-full bg-gold/15 flex items-center justify-center shrink-0">
            <span class="text-sm font-bold text-gold">{{ analysis.manager.name[0] }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between">
              <span class="text-sm font-semibold text-text-primary">{{ analysis.manager.name }}</span>
              <span class="text-[11px] text-text-muted">任职 {{ analysis.manager.tenure_days || 0 }} 天</span>
            </div>
            <button class="mt-2 text-xs text-primary bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-lg transition-colors"
              @click="loadStyleAnalysis">AI 分析投资风格</button>
            <div v-if="styleAnalysis" class="mt-2 p-3 rounded-lg bg-white/[0.03] text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
              {{ styleAnalysis }}
            </div>
          </div>
        </div>
        <div v-else class="flex flex-col items-center py-6">
          <User class="w-8 h-8 text-text-dim mb-2" />
          <p class="text-xs text-text-secondary">暂无基金经理信息</p>
          <p class="text-[10px] text-text-muted mt-1">可能因数据源更新延迟或该基金为指数基金</p>
        </div>
      </div>
    </section>

    <!-- 数据来源 -->
    <section v-if="analysis.data_sources?.length" class="px-4 pt-3 pb-4">
      <div class="glass-card p-4">
        <h3 class="text-sm font-medium text-text-primary mb-2">数据来源</h3>
        <div class="flex flex-wrap gap-2">
          <span v-for="s in analysis.data_sources" :key="s.name"
            class="text-[10px] px-2 py-1 rounded-full border"
            :class="s.available ? 'border-cyan/30 text-cyan bg-cyan/10' : 'border-text-dim text-text-muted bg-white/[0.03]'">
            {{ s.name }}
          </span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronLeft, User, Briefcase } from 'lucide-vue-next'
import ChartWrapper from '../components/ChartWrapper.vue'
import { getFundAnalysis, getManagerStyle } from '../api'

const route = useRoute()
const router = useRouter()
const code = route.params.code as string
const fundName = ref(code)
const analysis = ref<any>({})
const styleAnalysis = ref('')

const navColor = computed(() => {
  const g = analysis.value.day_growth
  if (g == null) return 'text-text-primary'
  return Number(g) >= 0 ? 'text-rise' : 'text-fall'
})
const dayColor = computed(() => {
  const g = analysis.value.day_growth
  if (g == null) return 'text-text-secondary'
  return Number(g) >= 0 ? 'text-rise' : 'text-fall'
})
const signalClass = computed(() => {
  const map: Record<string, string> = {
    '买入': 'text-rise bg-rise/10 border-rise/20',
    '持有': 'text-warn bg-warn/10 border-warn/20',
    '赎回': 'text-fall bg-fall/10 border-fall/20',
  }
  return map[analysis.value.signal as string] || 'text-text-secondary bg-white/[0.05] border-white/10'
})

const perfItems = computed(() => {
  const p = analysis.value
  return [
    { label: '近1月', val: p.near_1m },
    { label: '近3月', val: p.near_3m },
    { label: '近6月', val: p.near_6m },
    { label: '近1年', val: p.near_1y },
    { label: '近3年', val: p.near_3y },
    { label: '今年来', val: p.ytd },
  ].filter(i => i.val != null)
})

const riskItems = computed(() => {
  const r = analysis.value.risk || {}
  return [
    { label: '年化波动率', val: r.volatility != null ? r.volatility + '%' : null },
    { label: '夏普比率', val: r.sharpe },
    { label: '最大回撤', val: r.max_drawdown != null ? r.max_drawdown + '%' : null },
    { label: '卡玛比率', val: r.calmar },
    { label: '索提诺比率', val: r.sortino },
    { label: '信息比率', val: r.info_ratio },
  ].filter(i => i.val != null)
})

const navChartOption = computed(() => {
  const data = analysis.value.nav_data || []
  if (!data.length) return {}
  return {
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(15,22,35,0.9)', borderColor: 'rgba(255,255,255,0.1)', textStyle: { color: '#94A3B8', fontSize: 11 } },
    grid: { left: 40, right: 16, top: 16, bottom: 24 },
    xAxis: { type: 'category', data: data.map((d: any) => (d.date || '').slice(5)), axisLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } }, axisLabel: { color: '#475569', fontSize: 10 } },
    yAxis: { type: 'value', scale: true, axisLine: { show: false }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } }, axisLabel: { color: '#475569', fontSize: 10 } },
    series: [{
      type: 'line',
      data: data.map((d: any) => d.nav),
      smooth: true,
      lineStyle: { color: '#E8A735', width: 2 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(232,167,53,0.25)' }, { offset: 1, color: 'rgba(232,167,53,0)' }] } },
      itemStyle: { color: '#E8A735' },
      showSymbol: false,
    }],
  }
})

const radarChartOption = computed(() => {
  const scores = analysis.value.radar_scores || {}
  return {
    radar: {
      indicator: [
        { name: '收益能力', max: 100 },
        { name: '抗风险', max: 100 },
        { name: '稳定性', max: 100 },
        { name: '选股能力', max: 100 },
        { name: '择时能力', max: 100 },
      ],
      axisName: { color: '#475569', fontSize: 10 },
      splitArea: { areaStyle: { color: ['rgba(255,255,255,0.02)', 'rgba(255,255,255,0.04)'] } },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
    },
    series: [{
      type: 'radar',
      data: [{
        value: [scores.profitability || 50, scores.risk_control || 50, scores.stability || 50, scores.stock_picking || 50, scores.timing || 50],
        areaStyle: { color: 'rgba(0,240,255,0.15)' },
        lineStyle: { color: '#00F0FF', width: 2 },
        itemStyle: { color: '#00F0FF' },
      }],
    }],
  }
})

function formatNav(val: any): string {
  if (val == null) return '--'
  const n = Number(val)
  return isNaN(n) ? '--' : n.toFixed(4)
}
function formatDayGrowth(val: any): string {
  if (val == null) return '--'
  const n = Number(val)
  if (isNaN(n)) return '--'
  return n >= 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%`
}
function formatPct(val: any): string {
  if (val == null) return '--'
  const n = Number(val)
  if (isNaN(n)) return '--'
  return n >= 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%`
}

async function loadStyleAnalysis() {
  styleAnalysis.value = '正在分析中...'
  const res = await getManagerStyle(code)
  styleAnalysis.value = res?.style_analysis || '分析暂不可用'
}

onMounted(async () => {
  const res = await getFundAnalysis(code)
  analysis.value = res || {}
  if (res?.name) fundName.value = res.name
})
</script>
