<template>
  <div class="glass-card p-4 cursor-pointer transition-all duration-200 hover:bg-bg-hover hover:border-gold/20"
    @click="$emit('click')">
    <div class="flex items-start justify-between mb-2">
      <div class="flex-1 min-w-0">
        <h3 class="text-sm font-medium text-text-primary truncate">{{ fund.name || fund['基金简称'] }}</h3>
        <p class="text-xs text-text-secondary mt-0.5">{{ fund.code || fund['基金代码'] }}</p>
      </div>
      <span class="text-xs px-2 py-0.5 rounded-full border" :class="typeClass">{{ fund.type || fund['类型'] || '混合型' }}</span>
    </div>
    <div class="flex items-end justify-between mt-3">
      <div>
        <p class="text-xs text-text-secondary">最新净值</p>
        <p class="text-lg font-semibold text-text-primary">{{ formatNav(fund.nav || fund['单位净值']) }}</p>
      </div>
      <div class="text-right">
        <p class="text-xs text-text-secondary">{{ sortLabel }}</p>
        <p class="text-lg font-semibold" :class="changeColor">{{ formatPercent(mainReturn) }}</p>
      </div>
    </div>
    <div v-if="tags.length" class="flex gap-1.5 mt-3 flex-wrap">
      <span v-for="tag in tags.slice(0, 3)" :key="tag"
        class="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary-light">{{ tag }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  fund: Record<string, any>
  sortBy?: string
}>()

defineEmits(['click'])

const sortLabel = props.sortBy || '今年来'

const tags = computed(() => {
  const t = props.fund.tags
  return Array.isArray(t) ? t : []
})

const mainReturn = computed(() => {
  const val = props.fund.ytd ?? props.fund['今年来'] ?? props.fund.near_1y ?? props.fund['近1年']
  return typeof val === 'number' ? val : parseFloat(String(val || 0))
})

const changeColor = computed(() => {
  const val = mainReturn.value
  if (val > 0) return 'text-rise'
  if (val < 0) return 'text-fall'
  return 'text-text-secondary'
})

const typeClass = computed(() => {
  const type = String(props.fund.type || props.fund['类型'] || '')
  if (type.includes('股票')) return 'text-rise bg-rise/10 border-rise/20'
  if (type.includes('债券')) return 'text-fall bg-fall/10 border-fall/20'
  if (type.includes('指数')) return 'text-info bg-info/10 border-info/20'
  if (type.includes('QDII')) return 'text-warn bg-warn/10 border-warn/20'
  return 'text-gold bg-gold/10 border-gold/20'
})

function formatNav(val: any): string {
  if (val === null || val === undefined) return '--'
  const num = typeof val === 'string' ? parseFloat(val) : Number(val)
  return isNaN(num) ? '--' : num.toFixed(4)
}

function formatPercent(val: number): string {
  if (isNaN(val)) return '--'
  return val >= 0 ? `+${val.toFixed(2)}%` : `${val.toFixed(2)}%`
}
</script>
