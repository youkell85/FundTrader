import type { LifecyclePolicyRequest, LifecyclePolicyResponse } from '@/types/lifecycle'

const API_BASE = import.meta.env.VITE_API_BASE || '/fund/api'

export async function buildLifecyclePlan(params: LifecyclePolicyRequest): Promise<LifecyclePolicyResponse> {
  const response = await fetch(`${API_BASE}/allocation/lifecycle-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`生命周期计划生成失败：${response.status} ${text.slice(0, 200)}`)
  }
  return response.json()
}
