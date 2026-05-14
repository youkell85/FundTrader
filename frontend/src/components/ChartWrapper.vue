<template>
  <div class="glass-card overflow-hidden">
    <div v-if="title" class="px-4 pt-3 pb-2 border-b border-white/5">
      <h3 class="text-sm font-medium text-text-primary">{{ title }}</h3>
    </div>
    <div class="p-4">
      <v-chart :option="chartOption" :autoresize="true" style="height: 260px" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, BarChart, PieChart, RadarChart, HeatmapChart } from 'echarts/charts'
import {
  TitleComponent, TooltipComponent, LegendComponent,
  GridComponent, RadarComponent, VisualMapComponent,
} from 'echarts/components'

use([
  CanvasRenderer, LineChart, BarChart, PieChart, RadarChart, HeatmapChart,
  TitleComponent, TooltipComponent, LegendComponent, GridComponent,
  RadarComponent, VisualMapComponent,
])

const props = defineProps<{
  title?: string
  option: Record<string, unknown>
}>()

const chartOption = computed(() => ({
  backgroundColor: 'transparent',
  textStyle: { color: '#8B949E', fontFamily: 'PingFang SC' },
  ...props.option,
}))
</script>
