import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getFundList } from '../api'

export const useFundStore = defineStore('fund', () => {
  const funds = ref<any[]>([])
  const loading = ref(false)
  const categories = ref<Record<string, string[]>>({})
  const currentCategory = ref('全部')
  const currentTag = ref('')
  const currentSort = ref('今年来')
  const total = ref(0)
  const page = ref(1)

  async function fetchFunds(params: Record<string, any> = {}) {
    loading.value = true
    try {
      const res = await getFundList({
        category: currentCategory.value,
        tag: currentTag.value || undefined,
        sort_by: currentSort.value,
        page: page.value,
        page_size: 20,
        guoyuan_only: true,
        ...params,
      })
      funds.value = res?.funds || []
      total.value = res?.total || 0
      if (res?.categories) categories.value = res.categories
    } catch (e) {
      console.error('Fetch funds error:', e)
    }
    loading.value = false
  }

  return { funds, loading, categories, currentCategory, currentTag, currentSort, total, page, fetchFunds }
})
