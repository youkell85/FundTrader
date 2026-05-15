<template>
  <div class="min-h-screen pb-20">
    <header class="sticky top-0 z-40 glass-card border-b border-white/5">
      <div class="flex items-center gap-3 px-4 py-3">
        <h1 class="text-lg font-semibold text-text-primary">设置</h1>
      </div>
    </header>

    <!-- 自选基金管理 -->
    <section class="px-4 py-4">
      <div class="glass-card p-4">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-medium text-text-primary">自选基金</h2>
          <span class="text-xs text-text-secondary">{{ watchlist.length }} 只</span>
        </div>

        <!-- 手动添加 -->
        <div class="flex gap-2 mb-4">
          <input v-model="newCode" type="text" placeholder="输入基金代码，如 110011"
            class="flex-1 bg-bg-input rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none border border-white/5 focus:border-gold/30 transition-colors"
            @keyup.enter="handleAddFund" />
          <button @click="handleAddFund"
            class="px-4 py-2 rounded-lg bg-gold/20 text-gold text-sm font-medium hover:bg-gold/30 transition-colors disabled:opacity-50"
            :disabled="!newCode.trim() || adding">
            {{ adding ? '添加中...' : '添加' }}
          </button>
        </div>

        <!-- 文件上传 -->
        <div class="mb-4">
          <div class="flex items-center gap-2 mb-2">
            <Upload class="w-4 h-4 text-text-secondary" />
            <span class="text-xs text-text-secondary">上传基金名单文件</span>
          </div>
          <div class="relative">
            <input type="file" ref="fileInput"
              accept=".xlsx,.xls,.csv,.txt,.json,.png,.jpg,.jpeg,.gif,.webp,.bmp"
              class="hidden" @change="handleFileUpload" />
            <button @click="($refs.fileInput as HTMLInputElement)?.click()"
              class="w-full py-3 rounded-lg border-2 border-dashed border-white/10 text-xs text-text-secondary hover:border-gold/30 hover:text-gold transition-all"
              :class="uploading ? 'opacity-50 pointer-events-none' : ''">
              <template v-if="uploading">解析中...</template>
              <template v-else>点击上传 Excel / CSV / TXT / 图片 / JSON</template>
            </button>
          </div>
          <p class="text-[10px] text-text-muted mt-1">支持 .xlsx .xls .csv .txt .json .png .jpg 格式</p>
        </div>

        <!-- 文件解析结果预览 -->
        <div v-if="parsedFunds.length" class="mb-4 p-3 rounded-lg bg-bg-input">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-text-secondary">识别到 {{ parsedFunds.length }} 只基金</span>
            <div class="flex gap-2">
              <button @click="parsedFunds = []" class="text-[10px] text-text-muted hover:text-text-secondary">取消</button>
              <button @click="handleImportParsed" class="text-[10px] text-gold hover:text-gold/80">全部导入</button>
            </div>
          </div>
          <div class="max-h-40 overflow-y-auto space-y-1">
            <div v-for="f in parsedFunds" :key="f.code" class="flex items-center justify-between text-xs py-1">
              <span class="text-text-primary">{{ f.code }}</span>
              <span class="text-text-secondary truncate ml-2 flex-1">{{ f.name || '未知' }}</span>
              <button @click="handleAddSingle(f)" class="text-primary hover:text-primary/80 shrink-0 ml-2">添加</button>
            </div>
          </div>
        </div>

        <!-- 快捷导入 -->
        <div class="flex gap-2 mb-4">
          <button @click="handleImportGuoyuan"
            class="flex-1 py-2 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors">
            导入国元默认名单
          </button>
          <button @click="handleClearWatchlist"
            class="px-4 py-2 rounded-lg bg-fall/10 text-fall text-xs font-medium hover:bg-fall/20 transition-colors">
            清空
          </button>
        </div>

        <!-- 自选列表 -->
        <div v-if="watchlist.length" class="space-y-2">
          <div v-for="fund in watchlist" :key="fund.code"
            class="flex items-center justify-between p-3 rounded-lg bg-bg-input group">
            <div class="flex-1 min-w-0">
              <p class="text-sm text-text-primary truncate">{{ fund.name || fund.code }}</p>
              <p class="text-[10px] text-text-secondary">{{ fund.code }} · {{ fund.type || '未知' }}</p>
            </div>
            <button @click="handleRemoveFund(fund.code)"
              class="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-fall/10 transition-all">
              <X class="w-4 h-4 text-fall" />
            </button>
          </div>
        </div>
        <p v-else class="text-center text-xs text-text-secondary py-6">暂无自选基金，请添加或上传名单</p>
      </div>
    </section>

    <!-- 数据源说明 -->
    <section class="px-4 py-2">
      <div class="glass-card p-4">
        <h2 class="text-sm font-medium text-text-primary mb-3">数据说明</h2>
        <div class="space-y-2 text-xs text-text-secondary leading-relaxed">
          <p>基金数据来源于 AkShare、efinance 和东方财富公开接口，可能存在延迟。</p>
          <p>净值数据通常在交易日结束后更新，盘中估值为参考值。</p>
          <p>持仓数据按季度披露，存在滞后性。</p>
          <p>AI 分析结果仅供参考，不构成投资建议。</p>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Upload, X } from 'lucide-vue-next'
import {
  getWatchlist, addToWatchlist, batchAddToWatchlist,
  removeFromWatchlist, clearWatchlist, uploadFundFile,
  importGuoyuanFunds
} from '../api'

const watchlist = ref<any[]>([])
const newCode = ref('')
const adding = ref(false)
const uploading = ref(false)
const parsedFunds = ref<any[]>([])

async function fetchWatchlist() {
  try {
    const res = await getWatchlist()
    watchlist.value = res?.funds || []
  } catch (e) {
    console.error('Fetch watchlist error:', e)
  }
}

async function handleAddFund() {
  const code = newCode.value.trim()
  if (!code) return
  adding.value = true
  try {
    const res = await addToWatchlist({ code })
    if (res?.status === 'duplicate') {
      alert(res.message)
    } else {
      newCode.value = ''
      await fetchWatchlist()
    }
  } catch (e) {
    console.error('Add fund error:', e)
  }
  adding.value = false
}

async function handleAddSingle(fund: any) {
  try {
    await addToWatchlist({ code: fund.code, name: fund.name, type: fund.type })
    parsedFunds.value = parsedFunds.value.filter(p => p.code !== fund.code)
    await fetchWatchlist()
  } catch (e) {
    console.error('Add single error:', e)
  }
}

async function handleImportParsed() {
  if (!parsedFunds.value.length) return
  try {
    const funds = parsedFunds.value.map(f => ({ code: f.code, name: f.name, type: f.type }))
    await batchAddToWatchlist(funds)
    parsedFunds.value = []
    await fetchWatchlist()
  } catch (e) {
    console.error('Import parsed error:', e)
  }
}

async function handleFileUpload(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  uploading.value = true
  try {
    const res = await uploadFundFile(file)
    if (res?.funds?.length) {
      parsedFunds.value = res.funds
    }
    if (res?.errors?.length) {
      alert(res.errors.join('\n'))
    }
  } catch (e) {
    console.error('Upload error:', e)
    alert('文件上传失败，请重试')
  }
  uploading.value = false
  // 重置file input
  target.value = ''
}

async function handleImportGuoyuan() {
  try {
    const res = await importGuoyuanFunds()
    await fetchWatchlist()
    alert(`导入完成：新增 ${res?.added?.length || 0} 只，跳过 ${res?.skipped?.length || 0} 只已存在`)
  } catch (e) {
    console.error('Import guoyuan error:', e)
  }
}

async function handleRemoveFund(code: string) {
  try {
    await removeFromWatchlist(code)
    await fetchWatchlist()
  } catch (e) {
    console.error('Remove fund error:', e)
  }
}

async function handleClearWatchlist() {
  if (!confirm('确定要清空所有自选基金吗？')) return
  try {
    await clearWatchlist()
    await fetchWatchlist()
  } catch (e) {
    console.error('Clear watchlist error:', e)
  }
}

onMounted(() => { fetchWatchlist() })
</script>
