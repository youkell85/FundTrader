import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUserStore = defineStore('user', () => {
  const riskLevel = ref('稳健')
  const investmentHorizon = ref('中期')
  const amount = ref(100000)
  const preferences = ref<string[]>([])

  function setRiskLevel(level: string) { riskLevel.value = level }
  function setHorizon(horizon: string) { investmentHorizon.value = horizon }
  function setAmount(val: number) { amount.value = val }
  function togglePreference(tag: string) {
    const idx = preferences.value.indexOf(tag)
    if (idx >= 0) preferences.value.splice(idx, 1)
    else preferences.value.push(tag)
  }

  return { riskLevel, investmentHorizon, amount, preferences, setRiskLevel, setHorizon, setAmount, togglePreference }
})
