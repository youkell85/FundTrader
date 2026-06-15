import { useEffect, useMemo, useState } from 'react'
import { CockpitDashboard, type DashboardMode, type FundLike, type MarketOverviewPayload } from '@/components/dashboard/CockpitDashboard'
import { getMarketDataStatus, getMarketOverview } from '@/lib/api'
import { trpc } from '@/providers/trpc'
import type { MarketDataStatus } from '@/types/allocation'

function parseMetric(value: unknown): number | null {
  if (value === undefined || value === null || value === '' || value === '—' || value === '-') return null
  const num = parseFloat(String(value).replace('%', ''))
  return Number.isFinite(num) ? num : null
}

function bySharpeDesc(a: FundLike, b: FundLike) {
  return (parseMetric(b.performance?.sharpeRatio) ?? -999) - (parseMetric(a.performance?.sharpeRatio) ?? -999)
}

function isUserFund(fund: FundLike) {
  return fund.source === 'watchlist' || fund.isXinjihui === false
}

export default function Home() {
  const [marketOverview, setMarketOverview] = useState<MarketOverviewPayload | null>(null)
  const [marketStatus, setMarketStatus] = useState<MarketDataStatus | null>(null)
  const [marketLoading, setMarketLoading] = useState(true)
  const [marketError, setMarketError] = useState<string | null>(null)
  const { data: user } = trpc.auth.me.useQuery(undefined, { staleTime: 60_000 })
  const {
    data: listData,
    isLoading,
    isError,
    error,
  } = trpc.fund.list.useQuery(
    { page: 1, pageSize: 120, withMetrics: true, sortBy: 'sharpeRatio', sortOrder: 'desc' },
    { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false, retry: 1 },
  )

  useEffect(() => {
    let active = true
    setMarketLoading(true)
    setMarketError(null)

    Promise.allSettled([getMarketOverview(), getMarketDataStatus()])
      .then(([overviewResult, statusResult]) => {
        if (!active) return
        if (overviewResult.status === 'fulfilled') {
          setMarketOverview(overviewResult.value)
        } else {
          setMarketError(overviewResult.reason?.message || '市场全景数据加载失败')
        }

        if (statusResult.status === 'fulfilled') {
          setMarketStatus(statusResult.value)
        } else {
          setMarketStatus(null)
          setMarketError((prev) => prev || statusResult.reason?.message || '市场状态数据加载失败')
        }
      })
      .finally(() => {
        if (active) setMarketLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const { funds, mode } = useMemo<{ funds: FundLike[]; mode: DashboardMode }>(() => {
    const allFunds = ((listData as any)?.funds || []) as FundLike[]
    const sorted = [...allFunds].sort(bySharpeDesc)
    if (user) {
      const userFunds = sorted.filter(isUserFund)
      if (userFunds.length > 0) return { funds: userFunds.slice(0, 8), mode: 'user' }
      return { funds: sorted.slice(0, 8), mode: 'userEmptyFallback' }
    }
    return { funds: sorted.slice(0, 8), mode: 'bestSharpe' }
  }, [listData, user])

  return (
    <div className="min-h-screen bg-[#030504] px-3 pb-8 pt-16 sm:px-5 lg:px-8">
      <div className="mx-auto max-w-[1540px]">
        <CockpitDashboard
          funds={funds}
          mode={mode}
          userName={user?.name || user?.username}
          loading={isLoading}
          error={isError ? error?.message || '基金数据加载失败' : null}
          marketOverview={marketOverview}
          marketStatus={marketStatus}
          marketLoading={marketLoading}
          marketError={marketError}
        />
      </div>
    </div>
  )
}
