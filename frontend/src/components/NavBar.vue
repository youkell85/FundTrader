<template>
  <nav class="fixed bottom-0 left-0 right-0 z-50 glass-card border-t border-white/5 pb-safe">
    <div class="flex items-center justify-around h-14 max-w-lg mx-auto">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-all duration-200"
        :class="isActive(item.path) ? 'text-gold' : 'text-text-secondary hover:text-text-primary'"
      >
        <component :is="item.icon" class="w-5 h-5" />
        <span class="text-[10px] font-medium">{{ item.label }}</span>
      </router-link>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { LayoutGrid, Sparkles, TrendingUp, LineChart, BarChart3 } from 'lucide-vue-next'

const route = useRoute()

const navItems = [
  { path: '/home', label: '基金', icon: LayoutGrid },
  { path: '/recommend', label: '推荐', icon: Sparkles },
  { path: '/dca', label: '定投', icon: TrendingUp },
  { path: '/professional', label: '分析', icon: LineChart },
]

function isActive(path: string): boolean {
  if (path === '/home') return route.path === '/home' || route.path.startsWith('/fund/')
  return route.path === path
}
</script>
