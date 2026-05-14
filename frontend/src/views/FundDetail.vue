<template>
  <div class="min-h-screen pb-20">
    <header class="sticky top-0 z-40 glass-card border-b border-white/5">
      <div class="flex items-center gap-3 px-4 py-3">
        <button @click="router.back()" class="p-1.5 rounded-lg hover:bg-bg-hover transition-colors">
          <ChevronLeft class="w-5 h-5 text-text-secondary" />
        </button>
        <div class="flex-1 min-w-0">
          <h1 class="text-base font-semibold text-text-primary truncate">{{ fundName }}</h1>
          <p class="text-xs text-text-secondary">{{ code }}</p>
        </div>
        <span class="text-xs px-2 py-0.5 rounded-full border" :class="signalClass">{{ analysis.signal || '--' }}</span>
      </div>
      <div class="flex items-end justify-between px-4 pb-3">
        <div>
          <p class="text-3xl font-bold" :class="navColor">{{ formatNav(analysis.nav) }}</p>
          <p class="text-xs text-text-secondary mt-0.5">{{ analysis.nav_date || '' }}</p>
        </div>
        <div class="text-right">
          <p class="text-xl font-semibold" :class="dayColor">{{ formatDayGrowth(analysis.day_growth) }}</p>
          <p class="text-xs text-text-secondary">日涨跌幅</p>
        </div>
      </div>
    </header>

    <section class="px-4 py-3">
      <ChartWrapper title="业绩走势" :option="navChartOption" />
    </section>

    <section class="px-4 py-2">
      <ChartWrapper title="多维评估" :option="radarChartOption" />
    </section>

    <section class="px-4 py-2">
      <AnalysisCard title="配置价值评估" :score="analysis.score" :signal="analysis.signal" :confidence="analysis.confidence">
        <ul class="space-y-1.5 mt-2">
          <li v-for="(reason, i) in (analysis.reasons || [])" :key="i" class="text-xs text-text-secondary flex gap-2">
            <span class="text-gold">•</span><span>{{ reason }}</span>
          </li>
        </ul>
      </AnalysisCard>
    </section>

    <section class="px-4 py-2">
      <div class="glass-card p-4">
        <h3 class="text-sm font-medium text-text-primary mb-3">基金经理</h3>
        <div v-if="analysis.manager">
          <div class="flex items-center justify-between">
            <span class="text-base font-medium text-gold">{{ analysis.manager.name || '未知' }}</span>
            <span class="text-xs text-text-secondary">任职 {{ analysis.manager.tenure_days || 0 }} 天</span>
          </div>
          <button class="w-full text-xs text-primary py-2 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors mt-2"
            @click="loadStyleAnalysis">AI 分析投资风格</button>
          <div v-if="styleAnalysis" class="mt-2 p-3 rounded-lg bg-bg-input text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
            {{ styleAnalysis }}
          </div>
        </div>
        <p v-else class="text-xs text-text-secondary">暂无基金经理信息</p>
      </div>
    </section>

    <section v-if="analysis.holdings?.length" class="px-4 py-2">
      <div class="glass-card p-4">
        <h3 class="text-sm font-medium text-text-primary mb-3">前十大持仓</h3>
        <div class="space-y-2">
          <div v-for="(h, i) in analysis.holdings" :key="i" class="flex items-center justify-between text-xs">
            <span class="text-text-primary">{{ h.name }}</span>
            <span class="text-gold">{{ h.ratio }}%</span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronLeft } from 'lucide-vue-next'
import ChartWrapper from '../components/ChartWrapper.vue'
import AnalysisCard from '../components/AnalysisCard.vue'
import { getFundAnalysis, getManagerStyle } from '../api'

const route = useRoute()
const router = useRouter()
const code = route.params.code as string
const fundName = ref(code)
const analysis = ref<any>({})
const styleAnalysis = ref('')

const navColor = computed(() => {
  const g = analysis.value.day_growth
  if (!g) return 'text-text-primary'
  return Number(g) >= 0 ? 'text-rise' : 'text-fall'
})
const dayColor = computed(() => {
  const g = analysis.value.day_growth
  if (!g) return 'text-text-secondary'
  return Number(g) >= 0 ? 'text-rise' : 'text-fall'
})
const signalClass = computed(() => {
  const map: Record<string, string> = { '买入': 'text-rise bg-rise/10 border-rise/20', '持有': 'text-warn bg-warn/10 border-warn/20', '赎回': 'text-fall bg-fall/10 border-fall/20' }
  return map[analysis.value.signal as string] || 'text-text-secondary bg-bg-input border-white/5'
})

const navChartOption = computed(() => {
  const data = analysis.value.nav_data || []
  if (!data.length) return {}
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 16, top: 16, bottom: 24 },
    xAxis: { type: 'category', data: data.map((d: any) => (d.date || '').slice(5)), axisLine: { lineStyle: { color: '#21262D' } }, axisLabel: { color: '#8B949E', fontSize: 10 } },
    yAxis: { type: 'value', scale: true, axisLine: { show: false }, splitLine: { lineStyle: { color: '#21262D' } }, axisLabel: { color: '#8B949E', fontSize: 10 } },
    series: [{ type: 'line', data: data.map((d: any) => d.nav), smooth: true, lineStyle: { color: '#E8A735', width: 2 }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(232,167,53,0.3)' }, { offset: 1, color: 'rgba(232,167,53,0)' }] } }, itemStyle: { color: '#E8A735' }, showSymbol: false }],
  }
})

const radarChartOption = computed(() => {
  const scores = analysis.value.radar_scores || {}
  return {
    radar: { indicator: [{ name: '收益能力', max: 100 }, { name: '抗风险', max: 100 }, { name: '稳定性', max: 100 }, { name: '选股能力', max: 100 }, { name: '择时能力', max: 100 }], axisName: { color: '#8B949E', fontSize: 10 }, splitArea: { areaStyle: { color: ['rgba(22,27,34,0.8)', 'rgba(22,27,34,0.4)'] } }, splitLine: { lineStyle: { color: '#21262D' } }, axisLine: { lineStyle: { color: '#21262D' } } },
    series: [{ type: 'radar', data: [{ value: [scores.profitability || 50, scores.risk_control || 50, scores.stability || 50, scores.stock_picking || 50, scores.timing || 50], areaStyle: { color: 'rgba(232,167,53,0.2)' }, lineStyle: { color: '#E8A735', width: 2 }, itemStyle: { color: '#E8A735' } }] }],
  }
})

function formatNav(val: any): string { if (val == null) return '--'; const n = Number(val); return isNaN(n) ? '--' : n.toFixed(4) }
function formatDayGrowth(val: any): string { if (val == null) return '--'; const n = Number(val); if (isNaN(n)) return '--'; return n >= 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%` }

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
