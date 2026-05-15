<template>
  <div class="min-h-screen pb-20">
    <header class="sticky top-0 z-40 glass-card border-b border-white/5">
      <div class="flex items-center gap-3 px-4 py-3">
        <div class="flex-1 flex items-center gap-2 bg-bg-input rounded-lg px-3 py-2">
          <Search class="w-4 h-4 text-text-muted" />
          <input v-model="keyword" type="text" placeholder="搜索基金代码/名称"
            class="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted outline-none"
            @keyup.enter="handleSearch" />
        </div>
        <button class="p-2 rounded-lg bg-bg-input hover:bg-bg-hover transition-colors" @click="showFilter = !showFilter">
          <Sliders class="w-4 h-4 text-text-secondary" />
        </button>
      </div>
      <div class="flex gap-2 px-4 pb-3 overflow-x-auto scrollbar-hide">
        <button v-for="cat in categories" :key="cat"
          class="shrink-0 text-xs px-3 py-1.5 rounded-full transition-all duration-200"
          :class="currentCategory === cat ? 'bg-gold/20 text-gold border border-gold/30' : 'bg-bg-input text-text-secondary hover:text-text-primary border border-transparent'"
          @click="selectCategory(cat)">{{ cat }}</button>
      </div>
      <div class="flex items-center gap-2 px-4 pb-2">
        <button @click="useWatchlist = !useWatchlist; fetchFunds()"
          class="text-xs px-3 py-1 rounded-md transition-all flex items-center gap-1"
          :class="useWatchlist ? 'bg-primary/20 text-primary' : 'bg-bg-input text-text-secondary hover:text-text-primary'">
          <Star :class="useWatchlist ? 'w-3 h-3 fill-primary' : 'w-3 h-3'" />
          {{ useWatchlist ? '自选' : '默认' }}
        </button>
        <router-link to="/settings"
          class="text-xs px-3 py-1 rounded-md bg-bg-input text-text-secondary hover:text-text-primary transition-all flex items-center gap-1">
          <Settings2 class="w-3 h-3" /> 管理自选
        </router-link>
      </div>
      <div class="flex gap-1 px-4 pb-3 overflow-x-auto scrollbar-hide">
        <button v-for="s in sortOptions" :key="s"
          class="shrink-0 text-[11px] px-2.5 py-1 rounded-md transition-all"
          :class="currentSort === s ? 'bg-primary/20 text-primary' : 'text-text-muted hover:text-text-secondary'"
          @click="selectSort(s)">{{ s }}</button>
      </div>
    </header>

    <div v-if="showFilter" class="px-4 py-3 glass-card border-b border-white/5">
      <div class="flex flex-wrap gap-2">
        <span class="text-xs text-text-secondary mr-2 leading-7">标签：</span>
        <button v-for="tag in allTags" :key="tag"
          class="text-[11px] px-2.5 py-1 rounded-full border transition-all"
          :class="currentTag === tag ? 'bg-gold/15 text-gold border-gold/30' : 'bg-bg-input text-text-secondary border-transparent hover:border-white/10'"
          @click="selectTag(tag)">{{ tag }}</button>
      </div>
    </div>

    <div class="px-4 py-3 space-y-3">
      <div v-if="loading" class="flex items-center justify-center py-20">
        <div class="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
      </div>
      <template v-else-if="funds.length">
        <FundCard v-for="fund in funds" :key="fund.code || fund['基金代码']"
          :fund="fund" :sort-by="currentSort" @click="goDetail(fund)" />
      </template>
      <div v-else class="text-center py-20 text-text-secondary text-sm">暂无基金数据，请稍后重试</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Search, Sliders, Star, Settings2 } from 'lucide-vue-next'
import FundCard from '../components/FundCard.vue'
import { getFundList } from '../api'

const router = useRouter()
const loading = ref(false)
const funds = ref<any[]>([])
const keyword = ref('')
const currentCategory = ref('全部')
const currentSort = ref('今年来')
const currentTag = ref('')
const showFilter = ref(false)
const useWatchlist = ref(false)
const allTags = ref(['消费', '医药', '科技', '新能源', '金融', '成长', '价值', '蓝筹', 'QDII', '量化', '指数', '中小盘', '全球'])

const categories = ['全部', '股票型', '混合型', '债券型', '指数型', 'QDII']
const sortOptions = ['近1月', '近3月', '近6月', '近1年', '近3年', '今年来']

async function fetchFunds() {
  loading.value = true
  try {
    const res = await getFundList({
      category: currentCategory.value,
      tag: currentTag.value || undefined,
      keyword: keyword.value || undefined,
      sort_by: currentSort.value,
      guoyuan_only: !useWatchlist.value,
      use_watchlist: useWatchlist.value,
    })
    funds.value = res?.funds || []
  } catch (e) {
    console.error('Fetch error:', e)
  }
  loading.value = false
}

function selectCategory(cat: string) { currentCategory.value = cat; fetchFunds() }
function selectSort(s: string) { currentSort.value = s; fetchFunds() }
function selectTag(tag: string) { currentTag.value = currentTag.value === tag ? '' : tag; fetchFunds() }
function handleSearch() { fetchFunds() }
function goDetail(fund: any) { router.push(`/fund/${fund.code || fund['基金代码']}`) }

onMounted(() => { fetchFunds() })
</script>
