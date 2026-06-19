import { lazy, Suspense, useEffect } from 'react'
import { AllocationProvider } from './store/allocationStore'
import { Routes, Route, useLocation, Outlet, Navigate, Link } from 'react-router'
import Home from './pages/Home'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import Navbar from './components/Navbar'
import LuminousBackground from './components/LuminousBackground'
import { ErrorBoundary } from './components/ErrorBoundary'
import { trpc } from '@/providers/trpc'

// 路由级代码分割：详情/回测/分析/推荐页依赖 recharts（charts-vendor 428KB），
// 懒加载可避免首页首屏预加载这些重型图表库
const FundDetail = lazy(() => import('./pages/FundDetail'))
const Backtest = lazy(() => import('./pages/Backtest'))
const Recommend = lazy(() => import('./pages/Recommend'))
const Analysis = lazy(() => import('./pages/Analysis'))
const AllocationWizard = lazy(() => import('./pages/AllocationWizard'))

// 资产配置结果页 — 侧边导航布局 + 子路由
const AllocationLayout = lazy(() => import('./components/layout/AllocationLayout'))
const OverviewPage = lazy(() => import('./pages/allocation/OverviewPage'))
const MarketPage = lazy(() => import('./pages/allocation/MarketPage'))
const StrategyPage = lazy(() => import('./pages/allocation/StrategyPage'))
const FundsPage = lazy(() => import('./pages/allocation/FundsPage'))
const RiskPage = lazy(() => import('./pages/allocation/RiskPage'))

// 独立工具页面
const OpsPage = lazy(() => import('./pages/allocation/OpsPage'))
const PlansPage = lazy(() => import('./pages/allocation/PlansPage'))
const SimulatorPage = lazy(() => import('./pages/allocation/SimulatorPage'))
const BacktestPage = lazy(() => import('./pages/allocation/BacktestPage'))
const ExecutePage = lazy(() => import('./pages/allocation/ExecutePage'))

// 兼容旧路由：/allocation/result 重定向到新的配置中心
const LegacyAllocationDashboard = lazy(() => import('./pages/LegacyAllocationDashboard'))
const AdminDashboard = lazy(() => import('./pages/Admin'))

function PageLoader() {
  return (
    <div className="min-h-screen pt-14 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
    </div>
  )
}

function ScrollToTop() {
  const location = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname])

  return null
}

function AccessDenied() {
  return (
    <div className="workspace-shell min-h-screen pt-16 px-4">
      <div className="workspace-panel-strong mx-auto mt-12 max-w-lg p-6 text-center">
        <h1 className="text-xl font-semibold text-white">需要管理员权限</h1>
        <p className="mt-2 text-sm leading-relaxed text-white/50">
          当前账号没有访问管理控制台的权限。请切换管理员账号后再打开此页面。
        </p>
        <Link to="/" replace className="workspace-action-active mt-5 inline-flex h-10 items-center px-4 text-sm font-medium">
          返回基金市场
        </Link>
      </div>
    </div>
  )
}

function RequireAuth({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const location = useLocation()
  const { data: user, isLoading, isError } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    staleTime: 60 * 1000,
  })

  if (isLoading) return <PageLoader />
  if (isError || !user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ returnTo: `${location.pathname}${location.search}${location.hash}` }}
      />
    )
  }

  if (roles?.length && !roles.includes(user.role || 'user')) {
    return <AccessDenied />
  }

  return <>{children}</>
}

export default function App() {
  return (
    <div className="relative min-h-screen">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-primary focus:text-primary-foreground focus:text-sm focus:shadow-lg">
        跳转到主内容
      </a>
      <LuminousBackground />
      <div className="relative z-10 pb-16 md:pb-0">
        <Navbar />
        <ScrollToTop />
        <main id="main-content">
        <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            {/* /fund (no trailing slash) → redirect to /fund/ so basename routing resolves correctly */}
            <Route path="" element={<Navigate to="/" replace />} />
            <Route path="/ui-preview" element={<Navigate to="/" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/:code" element={<FundDetail />} />

            {/* 管理员 */}
            <Route path="/admin" element={<RequireAuth roles={['admin']}><AdminDashboard /></RequireAuth>} />

            {/* 需登录 */}
            <Route path="/backtest" element={<RequireAuth><Backtest /></RequireAuth>} />
            <Route path="/recommend" element={<RequireAuth><Recommend /></RequireAuth>} />
            <Route path="/analysis" element={<Analysis />} />
            {/* AllocationProvider 共享同一个实例，Wizard → Result 状态不丢失 */}
            <Route path="/allocation" element={<AllocationProvider><RequireAuth><Outlet /></RequireAuth></AllocationProvider>}>
              <Route index element={<AllocationWizard />} />
              <Route path="result" element={<AllocationLayout />}>
                <Route index element={<OverviewPage />} />
                <Route path="market" element={<MarketPage />} />
                <Route path="strategy" element={<StrategyPage />} />
                <Route path="funds" element={<FundsPage />} />
                <Route path="risk" element={<RiskPage />} />
                <Route path="ops" element={<OpsPage />} />
                <Route path="plans" element={<PlansPage />} />
                <Route path="simulator" element={<SimulatorPage />} />
                <Route path="backtest" element={<BacktestPage />} />
                <Route path="execute" element={<ExecutePage />} />
              </Route>
              <Route path=":id" element={<LegacyAllocationDashboard />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
