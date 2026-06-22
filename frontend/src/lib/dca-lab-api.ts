import type { DcaStrategyLabRequest, DcaStrategyLabResponse } from '@/types/dca-lab'

const API_BASE = import.meta.env.VITE_API_BASE || '/fund/api'

export async function runDcaStrategyLab(params: DcaStrategyLabRequest): Promise<DcaStrategyLabResponse> {
  const response = await fetch(`${API_BASE}/allocation/dca-strategy-lab`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`定投策略实验室请求失败：${response.status} ${body.slice(0, 200)}`)
  }
  return response.json()
}
