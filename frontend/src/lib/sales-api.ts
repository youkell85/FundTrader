import type { ComplianceResultModel, SalesNarrativeRequest, SalesNarrativeResponse } from '@/types/sales'

const API_BASE = import.meta.env.VITE_API_BASE || '/fund/api'

export async function generateSalesNarrative(params: SalesNarrativeRequest): Promise<SalesNarrativeResponse> {
  const response = await fetch(`${API_BASE}/sales/narrative`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`话术生成失败：${response.status} ${text.slice(0, 200)}`)
  }
  return response.json()
}

export async function checkSalesCompliance(text: string): Promise<{ compliance: ComplianceResultModel; audit_id: string }> {
  const response = await fetch(`${API_BASE}/sales/compliance-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`合规检查失败：${response.status} ${body.slice(0, 200)}`)
  }
  return response.json()
}
