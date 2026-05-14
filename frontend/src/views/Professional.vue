<template>
  <div class="min-h-screen pb-20">
    <header class="sticky top-0 z-40 glass-card border-b border-white/5 px-4 py-3">
      <h1 class="text-base font-semibold text-gold">专业分析</h1>
      <p class="text-xs text-text-secondary mt-0.5">多维专业指标深度评估</p>
    </header>

    <section class="px-4 py-4">
      <div class="glass-card p-4">
        <h3 class="text-sm font-medium text-text-primary mb-3">选择基金</h3>
        <div class="flex flex-wrap gap-2">
          <button v-for="fund in fundOptions" :key="fund.code"
            class="text-xs px-3 py-1.5 rounded-full border transition-all"
            :class="selectedCode === fund.code ? 'bg-gold/15 text-gold border-gold/30' : 'bg-bg-input text-text-secondary border-transparent'"
            @click="selectFund(fund.code)">{{ fund.name.slice(0, 6) }}</button>
        </div>
      </div>
    </section>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <div class="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
    </div>

    <template v-else-if="analysis.code">
      <section class="px-4 py-2">
        <div class="glass-card p-4">
          <h3 class="text-sm font-medium text-gold mb-3">风险收益指标</h3>
          <div class="grid grid-cols-2 gap-3">
            <div class="p-3 rounded-lg bg-bg-input">
              <p class="text-[10px] text-text-secondary">夏普比率</p>
              <p class="text-lg font-semibold" :class="analysis.sharpe_ratio > 1 ? 'text-rise' : analysis.sharpe_ratio > 0 ? 'text-warn' : 'text-fall'">{{ Number(analysis.sharpe_ratio).toFixed(3) }}</p>
            </div>
            <div class="p-3 rounded-lg bg-bg-input">
              <p class="text-[10px] text-text-secondary">最大回撤</p>
              <p class="text-lg font-semibold text-fall">{{ Number(analysis.max_drawdown).toFixed(2) }}%</p>
            </div>
            <div class="p-3 rounded-lg bg-bg-input">
              <p class="text-[10px] text-text-secondary">年化波动率</p>
              <p class="text-lg font-semibold text-warn">{{ Number(analysis.volatility).toFixed(2) }}%</p>
            </div>
            <div class="p-3 rounded-lg bg-bg-input">
              <p class="text-[10px] text-text-secondary">Calmar比率</p>
              <p class="text-lg font-semibold" :class="analysis.calmar_ratio > 1 ? 'text-rise' : 'text-warn'">{{ Number(analysis.calmar_ratio).toFixed(3) }}</p>
            </div>
            <div class="p-3 rounded-lg bg-bg-input col-span-2">
              <p class="text-[10px] text-text-secondary">Sortino比率</p>
              <p class="text-lg font-semibold" :class="analysis.sortino_ratio > 1 ? 'text-rise' : 'text-warn'">{{ Number(analysis.sortino_ratio).toFixed(3) }}</p>
            </div>
          </div>
        </div>
      </section>

      <section v-if="analysis.style_box" class="px-4 py-2">
        <div class="glass-card p-4">
          <h3 class="text-sm font-medium text-gold mb-3">风格分析</h3>
          <div class="grid grid-cols-3 gap-1.5">
            <div v-for="(cell, i) in styleGrid" :key="i"
              class="p-2 rounded text-center text-[10px] transition-all"
              :class="cell.active ? 'bg-gold/20 text-gold border border-gold/30' : 'bg-bg-input text-text-muted'">{{ cell.label }}</div>
          </div>
        </div>
      </section>

      <section v-if="analysis.asset_allocation" class="px-4 py-2">
        <ChartWrapper title="资产配置" :option="assetChartOption" />
      </section>

      <section v-if="analysis.nav_summary" class="px-4 py-2">
        <div class="glass-card p-4">
          <h3 class="text-sm font-medium text-text-primary mb-2">数据摘要</h3>
          <div class="space-y-1.5 text-xs text-text-secondary">
            <p>最新净值: <span class="text-text-primary">{{ analysis.nav_summary.latest }}</span></p>
            <p>区间收益: <span :class="analysis.nav_summary.period_return >= 0 ? 'text-rise' : 'text-fall'">{{ analysis.nav_summary.period_return >= 0 ? '+' : '' }}{{ analysis.nav_summary.period_return }}%</span></p>
            <p>数据点数: {{ analysis.nav_summary.data_points }}</p>
            <p>区间: {{ analysis.nav_summary.start_date }} ~ {{ analysis.nav_summary.end_date }}</p>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import ChartWrapper from '../components/ChartWrapper.vue'
import { getProfessionalAnalysis } from '../api'

const fundOptions = [
  { code: '007119', name: '睿远成长价值混合A' },
  { code: '001938', name: '中欧时代先锋股票A' },
  { code: '017954', name: '汇添富中证1000指数增强C' },
  { code: '009318', name: '南方成长先锋混合A' },
  { code: '010186', name: '嘉实核心成长混合A' },
]

const selectedCode = ref('007119')
const loading = ref(false)
const analysis = ref<any>({})

const styleGrid = computed(() => {
  const box = analysis.value.style_box || {}
  const sizeIdx = box.box?.[0] ?? 1
  const styleIdx = box.box?.[1] ?? 1
  const grid = ['大盘价值', '大盘均衡', '大盘成长', '中盘价值', '中盘均衡', '中盘成长', '小盘价值', '小盘均衡', '小盘成长']
  return grid.map((label, i) => ({ label, active: Math.floor(i / 3) === sizeIdx && i % 3 === styleIdx }))
})

const assetChartOption = computed(() => {
  const alloc = analysis.value.asset_allocation || {}
  const data = Object.entries(alloc).filter(([_, v]) => Number(v) > 0).map(([k, v]) => ({ name: k, value: v }))
  const colorMap: Record<string, string> = { stocks: '#E8A735', bonds: '#1A73E8', cash: '#22C55E', other: '#8B949E' }
  return {
    tooltip: { trigger: 'item' },
    series: [{ type: 'pie', radius: ['35%', '65%'], data: data.map((d: any) => ({ ...d, itemStyle: { color: colorMap[d.name] || '#8B949E' } })), label: { color: '#8B949E', fontSize: 10, formatter: '{b}: {d}%' } }],
  }
})

async function selectFund(code: string) {
  selectedCode.value = code
  loading.value = true
  const res = await getProfessionalAnalysis(code)
  analysis.value = res || {}
  loading.value = false
}

selectFund('007119')
</script>
