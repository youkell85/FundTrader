import { useEffect, useMemo, useState } from 'react'
import { CockpitDashboard, type DashboardMode, type FundLike, type MarketOverviewPayload } from '@/components/dashboard/CockpitDashboard'
import WorkspaceShell from '@/components/layout/WorkspaceShell'
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

function isReliableDashboardCandidate(fund: FundLike) {
  const nav = parseMetric(fund.nav)
  const sharpe = parseMetric(fund.performance?.sharpeRatio)
  const dataQuality = String(fund.dataQuality || '').toLowerCase()
  const staleLevel = String(fund.staleLevel || '').toLowerCase()
  return (
    nav !== null &&
    nav > 0 &&
    sharpe !== null &&
    Boolean(fund.navDate) &&
    dataQuality !== 'seeded' &&
    staleLevel !== 'missing'
  )
}

const MARKET_LOAD_MAX_ATTEMPTS = 4
const MARKET_LOAD_RETRY_DELAY_MS = 4_000

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

type SavedDashboardPlan = {
  name?: string | null
  createdAt?: string | null
  funds: FundLike[]
}

function latestSavedRecommendationPlan(stateData: unknown): SavedDashboardPlan | null {
  const records = (stateData as any)?.recommendationRecords
  if (!Array.isArray(records) || records.length === 0) return null

  for (const record of records) {
    const plans = Array.isArray(record?.plans) ? record.plans : []
    const plan = plans[0]
    const allocations = Array.isArray(plan?.fundAllocations) ? plan.fundAllocations : []
    const funds = allocations
      .map((allocation: any) => {
        const fund = allocation?.fund || {}
        const code = String(fund.fundCode || fund.code || allocation?.code || '')
        if (!/^\d{6}$/.test(code)) return null
        return {
          ...fund,
          fundCode: code,
          fundName: fund.fundName || fund.name || allocation?.name || code,
          fundType: fund.fundType || fund.type || fund.category,
          weight: allocation?.weight,
          targetWeight: allocation?.weight,
          source: 'recommendation',
        } as FundLike
      })
      .filter((fund: FundLike | null): fund is FundLike => fund !== null)

    if (funds.length > 0) {
      return {
        name: plan?.name || null,
        createdAt: record?.createdAt || null,
        funds,
      }
    }
  }

  return null
}

export default function Home() {
  const [marketOverview, setMarketOverview] = useState<MarketOverviewPayload | null>(null)
  const [marketStatus, setMarketStatus] = useState<MarketDataStatus | null>(null)
  const [marketLoading, setMarketLoading] = useState(true)
  const [marketError, setMarketError] = useState<string | null>(null)
  const { data: user } = trpc.auth.me.useQuery(undefined, { staleTime: 60_000 })
  const { data: userState } = trpc.auth.state.useQuery(undefined, {
    enabled: Boolean(user),
    staleTime: 60_000,
  })
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

    async function loadMarketData() {
      setMarketLoading(true)
      setMarketError(null)

      let lastError = '市场全景数据加载失败'
      for (let attempt = 1; attempt <= MARKET_LOAD_MAX_ATTEMPTS; attempt += 1) {
        const [overviewResult, statusResult] = await Promise.allSettled([getMarketOverview(), getMarketDataStatus()])
        if (!active) return

        if (statusResult.status === 'fulfilled') {
          setMarketStatus(statusResult.value)
        } else {
          setMarketStatus(null)
          lastError = statusResult.reason?.message || lastError
        }

        if (overviewResult.status === 'fulfilled' && (overviewResult.value?.market?.length || 0) > 0) {
          setMarketOverview(overviewResult.value)
          setMarketError(null)
          setMarketLoading(false)
          return
        }

        if (overviewResult.status === 'fulfilled') {
          lastError = '市场全景接口暂未返回指数数据'
        } else {
          lastError = overviewResult.reason?.message || lastError
        }

        if (attempt < MARKET_LOAD_MAX_ATTEMPTS) {
          await wait(MARKET_LOAD_RETRY_DELAY_MS)
        }
      }

      if (!active) return
      setMarketError(lastError)
      setMarketLoading(false)
    }

    loadMarketData()

    return () => {
      active = false
    }
  }, [])

  const { funds, mode, portfolioName, portfolioCreatedAt } = useMemo<{
    funds: FundLike[]
    mode: DashboardMode
    portfolioName?: string | null
    portfolioCreatedAt?: string | null
  }>(() => {
    const savedPlan = latestSavedRecommendationPlan(userState)
    if (user && savedPlan) {
      return {
        funds: savedPlan.funds.slice(0, 8),
        mode: 'savedRecommendation',
        portfolioName: savedPlan.name,
        portfolioCreatedAt: savedPlan.createdAt,
      }
    }

    const allFunds = ((listData as any)?.funds || []) as FundLike[]
    const sorted = [...allFunds].sort(bySharpeDesc)
    const reliableCandidates = sorted.filter(isReliableDashboardCandidate)
    if (user) {
      const userFunds = sorted.filter(isUserFund)
      if (userFunds.length > 0) return { funds: userFunds.slice(0, 8), mode: 'userWatchlist' }
      return { funds: reliableCandidates.slice(0, 8), mode: 'userEmptyFallback' }
    }
    return { funds: reliableCandidates.slice(0, 8), mode: 'candidatePool' }
  }, [listData, user, userState])

  return (
    <WorkspaceShell>
      <div className="workspace-page">
        <CockpitDashboard
          funds={funds}
          mode={mode}
          userName={user?.name || user?.username}
          portfolioName={portfolioName}
          portfolioCreatedAt={portfolioCreatedAt}
          loading={isLoading}
          error={isError ? error?.message || '基金数据加载失败' : null}
          marketOverview={marketOverview}
          marketStatus={marketStatus}
          marketLoading={marketLoading}
          marketError={marketError}
        />
      </div>
    </WorkspaceShell>
  )
}
