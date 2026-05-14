<template>
  <div class="min-h-screen pb-20">
    <header class="sticky top-0 z-40 glass-card border-b border-white/5 px-4 py-3">
      <h1 class="text-base font-semibold text-gold">智能推荐</h1>
      <p class="text-xs text-text-secondary mt-0.5">基于风险偏好，为您定制配置方案</p>
    </header>

    <section class="px-4 py-4">
      <div class="glass-card p-4">
        <h3 class="text-sm font-medium text-text-primary mb-3">风险偏好</h3>
        <div class="grid grid-cols-4 gap-2">
          <button v-for="level in riskLevels" :key="level.value"
            class="py-2.5 rounded-lg text-xs font-medium transition-all duration-200 border"
            :class="userStore.riskLevel === level.value ? 'bg-gold/15 text-gold border-gold/30 glow-gold' : 'bg-bg-input text-text-secondary border-transparent hover:border-white/10'"
            @click="userStore.setRiskLevel(level.value)">{{ level.label }}</button>
        </div>
        <h3 class="text-sm font-medium text-text-primary mt-4 mb-3">投资期限</h3>
        <div class="grid grid-cols-3 gap-2">
          <button v-for="h in horizons" :key="h"
            class="py-2 rounded-lg text-xs transition-all border"
            :class="userStore.investmentHorizon === h ? 'bg-primary/15 text-primary border-primary/30' : 'bg-bg-input text-text-secondary border-transparent'"
            @click="userStore.setHorizon(h)">{{ h }}</button>
        </div>
        <h3 class="text-sm font-medium text-text-primary mt-4 mb-3">偏好标签</h3>
        <div class="flex flex-wrap gap-2">
          <button v-for="tag in prefTags" :key="tag"
            class="text-xs px-3 py-1.5 rounded-full border transition-all"
            :class="userStore.preferences.includes(tag) ? 'bg-gold/15 text-gold border-gold/30' : 'bg-bg-input text-text-secondary border-transparent'"
            @click="userStore.togglePreference(tag)">{{ tag }}</button>
        </div>
        <button class="w-full mt-4 py-3 rounded-xl text-sm font-medium bg-gradient-to-r from-gold to-gold-light text-bg transition-all hover:opacity-90 active:scale-[0.98]"
          @click="generatePlan">生成配置方案</button>
      </div>
    </section>

    <section v-if="market.length" class="px-4 py-2">
      <div class="glass-card p-4">
        <h3 class="text-sm font-medium text-text-primary mb-3">市场行情</h3>
        <div class="grid grid-cols-3 gap-3">
          <div v-for="m in market" :key="m.code" class="text-center">
            <p class="text-xs text-text-secondary">{{ m.name }}</p>
            <p class="text-sm font-semibold" :class="Number(m.change) >= 0 ? 'text-rise' : 'text-fall'">{{ Number(m.close || 0).toFixed(2) }}</p>
            <p class="text-[10px]" :class="Number(m.change) >= 0 ? 'text-rise' : 'text-fall'">{{ Number(m.change) >= 0 ? '+' : '' }}{{ Number(m.change || 0).toFixed(2) }}%</p>
          </div>
        </div>
      </div>
    </section>

    <section v-if="recommendation.funds?.length" class="px-4 py-2 space-y-3">
      <div class="glass-card p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-medium text-gold">推荐配置方案</h3>
          <span class="text-xs px-2 py-0.5 rounded-full" :class="riskClass">{{ userStore.riskLevel }}</span>
        </div>
        <ChartWrapper :option="pieChartOption" />
        <div class="space-y-2 mt-3">
          <div v-for="fund in recommendation.funds" :key="fund.code"
            class="flex items-center justify-between p-3 rounded-lg bg-bg-input">
            <div class="flex-1 min-w-0">
              <p class="text-sm text-text-primary truncate">{{ fund.name }}</p>
              <p class="text-xs text-text-secondary">{{ fund.code }} · {{ fund.type }}</p>
            </div>
            <div class="text-right ml-3">
              <p class="text-sm font-semibold text-gold">{{ (fund.ratio * 100).toFixed(0) }}%</p>
              <p class="text-xs text-text-secondary">{{ formatAmount(fund.amount) }}</p>
            </div>
          </div>
        </div>
        <div class="flex items-center justify-between mt-4 p-3 rounded-lg bg-bg-input">
          <div class="text-center flex-1">
            <p class="text-xs text-text-secondary">预期年化</p>
            <p class="text-lg font-semibold text-rise">+{{ recommendation.expected_return }}%</p>
          </div>
          <div class="w-px h-8 bg-white/5" />
          <div class="text-center flex-1">
            <p class="text-xs text-text-secondary">预期波动</p>
            <p class="text-lg font-semibold text-warn">{{ recommendation.expected_risk }}%</p>
          </div>
        </div>
      </div>
      <div v-if="recommendation.llm_analysis" class="glass-card p-4">
        <h3 class="text-sm font-medium text-gold mb-2">AI 配置建议</h3>
        <p class="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">{{ recommendation.llm_analysis }}</p>
      </div>
      <div v-if="recommendation.analysis_summary" class="glass-card p-4">
        <h3 class="text-sm font-medium text-text-primary mb-2">方案摘要</h3>
        <p class="text-xs text-text-secondary leading-relaxed">{{ recommendation.analysis_summary }}</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useUserStore } from '../stores/user'
import ChartWrapper from '../components/ChartWrapper.vue'
import { postRecommend, getMarketOverview } from '../api'

const userStore = useUserStore()
const recommendation = ref<any>({})
const market = ref<any[]>([])

const riskLevels = [{ value: '保守', label: '保守' }, { value: '稳健', label: '稳健' }, { value: '积极', label: '积极' }, { value: '激进', label: '激进' }]
const horizons = ['短期', '中期', '长期']
const prefTags = ['消费', '科技', '医药', '新能源', '金融', '成长', '价值', 'QDII', '量化']

const riskClass = computed(() => {
  const map: Record<string, string> = { '保守': 'text-info bg-info/10', '稳健': 'text-primary bg-primary/10', '积极': 'text-warn bg-warn/10', '激进': 'text-rise bg-rise/10' }
  return map[userStore.riskLevel] || ''
})

const pieChartOption = computed(() => {
  const funds = recommendation.value.funds || []
  if (!funds.length) return {}
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {d}%' },
    series: [{ type: 'pie', radius: ['40%', '70%'], center: ['50%', '50%'], data: funds.map((f: any, i: number) => ({ name: f.name, value: (f.ratio * 100).toFixed(0), itemStyle: { color: ['#E8A735', '#1A73E8', '#22C55E', '#6366F1', '#EF4444', '#F59E0B'][i % 6] } })), label: { color: '#8B949E', fontSize: 10 }, labelLine: { lineStyle: { color: '#484F58' } } }],
  }
})

function formatAmount(val: any): string { const n = Number(val || 0); if (n >= 10000) return `${(n / 10000).toFixed(1)}万`; return n.toFixed(0) }

async function generatePlan() {
  const res = await postRecommend({ risk_level: userStore.riskLevel, investment_horizon: userStore.investmentHorizon, amount: userStore.amount, preferences: userStore.preferences })
  recommendation.value = res || {}
}

onMounted(async () => {
  const res = await getMarketOverview()
  market.value = res?.market || []
})
</script>
