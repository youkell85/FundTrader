<template>
  <div class="min-h-screen pb-20">
    <header class="sticky top-0 z-40 glass-card border-b border-white/5 px-4 py-3">
      <h1 class="text-base font-semibold text-gold">定投回测</h1>
      <p class="text-xs text-text-secondary mt-0.5">智能定投策略建议与历史回测</p>
    </header>

    <section class="px-4 py-4">
      <div class="glass-card p-4">
        <h3 class="text-sm font-medium text-text-primary mb-3">选择基金</h3>
        <div class="flex flex-wrap gap-2">
          <button v-for="fund in fundOptions" :key="fund.code"
            class="text-xs px-3 py-1.5 rounded-full border transition-all"
            :class="selectedCodes.includes(fund.code) ? 'bg-gold/15 text-gold border-gold/30' : 'bg-bg-input text-text-secondary border-transparent'"
            @click="toggleFund(fund.code)">{{ fund.name.slice(0, 6) }}</button>
        </div>
        <h3 class="text-sm font-medium text-text-primary mt-4 mb-3">定投策略</h3>
        <div class="grid grid-cols-3 gap-2">
          <button v-for="s in strategies" :key="s.value"
            class="py-2 rounded-lg text-xs transition-all border"
            :class="strategy === s.value ? 'bg-primary/15 text-primary border-primary/30' : 'bg-bg-input text-text-secondary border-transparent'"
            @click="strategy = s.value">{{ s.label }}</button>
        </div>
        <div class="grid grid-cols-2 gap-3 mt-4">
          <div>
            <label class="text-xs text-text-secondary block mb-1">定投金额</label>
            <input v-model.number="amount" type="number"
              class="w-full bg-bg-input rounded-lg px-3 py-2 text-sm text-text-primary outline-none border border-transparent focus:border-gold/30" />
          </div>
          <div>
            <label class="text-xs text-text-secondary block mb-1">定投频率</label>
            <select v-model="frequency"
              class="w-full bg-bg-input rounded-lg px-3 py-2 text-sm text-text-primary outline-none border border-transparent focus:border-gold/30">
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
            </select>
          </div>
        </div>
        <button class="w-full mt-4 py-3 rounded-xl text-sm font-medium bg-gradient-to-r from-gold to-gold-light text-bg transition-all hover:opacity-90 active:scale-[0.98]"
          :disabled="!selectedCodes.length || running" @click="runBacktest">{{ running ? '回测中...' : '开始回测' }}</button>
      </div>
    </section>

    <section v-if="results.individual?.length" class="px-4 py-2 space-y-3">
      <div v-for="res in results.individual" :key="res.fund_code" class="glass-card p-4">
        <div v-if="res.error" class="text-xs text-fall">{{ res.error }}</div>
        <template v-else>
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-medium text-gold">{{ res.fund_code }}</h3>
            <span class="text-xs text-text-secondary">{{ res.strategy }}</span>
          </div>
          <div class="grid grid-cols-2 gap-3 mb-3">
            <div class="p-2.5 rounded-lg bg-bg-input text-center">
              <p class="text-[10px] text-text-secondary">总投入</p>
              <p class="text-sm font-semibold text-text-primary">{{ formatNum(res.total_invested) }}</p>
            </div>
            <div class="p-2.5 rounded-lg bg-bg-input text-center">
              <p class="text-[10px] text-text-secondary">总市值</p>
              <p class="text-sm font-semibold text-text-primary">{{ formatNum(res.total_value) }}</p>
            </div>
            <div class="p-2.5 rounded-lg bg-bg-input text-center">
              <p class="text-[10px] text-text-secondary">总收益</p>
              <p class="text-sm font-semibold" :class="res.total_profit_rate >= 0 ? 'text-rise' : 'text-fall'">{{ res.total_profit_rate >= 0 ? '+' : '' }}{{ Number(res.total_profit_rate).toFixed(2) }}%</p>
            </div>
            <div class="p-2.5 rounded-lg bg-bg-input text-center">
              <p class="text-[10px] text-text-secondary">年化收益</p>
              <p class="text-sm font-semibold" :class="res.annual_return >= 0 ? 'text-rise' : 'text-fall'">{{ res.annual_return >= 0 ? '+' : '' }}{{ Number(res.annual_return).toFixed(2) }}%</p>
            </div>
          </div>
          <ChartWrapper v-if="res.nav_curve?.length" :option="dcaChartOption(res.nav_curve)" />
          <div class="flex items-center justify-between mt-2 text-xs text-text-secondary">
            <span>最大回撤: <span class="text-fall">{{ Number(res.max_drawdown).toFixed(2) }}%</span></span>
            <span>定投 {{ res.trade_count }} 次</span>
          </div>
        </template>
      </div>

      <div v-if="results.combined" class="glass-card p-4 glow-gold">
        <h3 class="text-sm font-medium text-gold mb-3">组合回测结果</h3>
        <div class="grid grid-cols-3 gap-3">
          <div class="text-center">
            <p class="text-[10px] text-text-secondary">总收益率</p>
            <p class="text-lg font-semibold" :class="results.combined.total_profit_rate >= 0 ? 'text-rise' : 'text-fall'">{{ Number(results.combined.total_profit_rate).toFixed(2) }}%</p>
          </div>
          <div class="text-center">
            <p class="text-[10px] text-text-secondary">年化收益</p>
            <p class="text-lg font-semibold" :class="results.combined.annual_return >= 0 ? 'text-rise' : 'text-fall'">{{ Number(results.combined.annual_return).toFixed(2) }}%</p>
          </div>
          <div class="text-center">
            <p class="text-[10px] text-text-secondary">最大回撤</p>
            <p class="text-lg font-semibold text-fall">{{ Number(results.combined.max_drawdown).toFixed(2) }}%</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import ChartWrapper from '../components/ChartWrapper.vue'
import { postDcaBacktest } from '../api'

const fundOptions = [
  { code: '007119', name: '睿远成长价值混合A' },
  { code: '001938', name: '中欧时代先锋股票A' },
  { code: '017954', name: '汇添富中证1000指数增强C' },
  { code: '012920', name: '易方达全球成长精选QDII' },
  { code: '009318', name: '南方成长先锋混合A' },
  { code: '010186', name: '嘉实核心成长混合A' },
]

const selectedCodes = ref<string[]>(['007119'])
const strategy = ref('compare')
const amount = ref(1000)
const frequency = ref('monthly')
const running = ref(false)
const results = ref<any>({})

const strategies = [{ value: 'fixed', label: '固定金额' }, { value: 'ma', label: '均线偏离' }, { value: 'compare', label: '策略对比' }]

function toggleFund(code: string) {
  const idx = selectedCodes.value.indexOf(code)
  if (idx >= 0) selectedCodes.value.splice(idx, 1)
  else selectedCodes.value.push(code)
}

function formatNum(val: any): string { return Number(val || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) }

function dcaChartOption(curve: any[]) {
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 16, top: 16, bottom: 24 },
    xAxis: { type: 'category', data: curve.map((c: any) => (c.date || '').slice(5)), axisLabel: { color: '#8B949E', fontSize: 9 }, axisLine: { lineStyle: { color: '#21262D' } } },
    yAxis: { type: 'value', axisLabel: { color: '#8B949E', fontSize: 9 }, splitLine: { lineStyle: { color: '#21262D' } } },
    series: [
      { name: '投入', type: 'line', data: curve.map((c: any) => c.invested), lineStyle: { color: '#8B949E', width: 1, type: 'dashed' }, itemStyle: { color: '#8B949E' }, showSymbol: false },
      { name: '市值', type: 'line', data: curve.map((c: any) => c.value), smooth: true, lineStyle: { color: '#E8A735', width: 2 }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(232,167,53,0.2)' }, { offset: 1, color: 'rgba(232,167,53,0)' }] } }, itemStyle: { color: '#E8A735' }, showSymbol: false },
    ],
  }
}

async function runBacktest() {
  if (!selectedCodes.value.length) return
  running.value = true
  const res = await postDcaBacktest({ codes: selectedCodes.value, amount: amount.value, frequency: frequency.value, strategy: strategy.value })
  results.value = res || {}
  running.value = false
}
</script>
