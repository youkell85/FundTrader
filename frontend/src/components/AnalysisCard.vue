<template>
  <div class="glass-card glow-gold p-4">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-medium text-gold">{{ title }}</h3>
      <span v-if="score !== undefined" class="text-2xl font-bold" :class="scoreColor">{{ score }}</span>
    </div>
    <div v-if="signal" class="flex items-center gap-2 mb-2">
      <span class="text-xs px-2 py-0.5 rounded-full border" :class="signalClass">{{ signal }}</span>
      <span v-if="confidence" class="text-xs text-text-secondary">置信度 {{ (confidence * 100).toFixed(0) }}%</span>
    </div>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  title: string
  score?: number
  signal?: string
  confidence?: number
}>()

const scoreColor = computed(() => {
  if (!props.score) return 'text-text-primary'
  if (props.score >= 70) return 'text-rise'
  if (props.score >= 40) return 'text-warn'
  return 'text-fall'
})

const signalClass = computed(() => {
  const map: Record<string, string> = {
    '买入': 'text-rise bg-rise/10 border-rise/20',
    '持有': 'text-warn bg-warn/10 border-warn/20',
    '赎回': 'text-fall bg-fall/10 border-fall/20',
  }
  return map[props.signal || ''] || 'text-text-secondary bg-bg-input border-white/5'
})
</script>
