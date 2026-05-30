import { lazy, Suspense, useEffect } from 'react'
import { AllocationProvider } from './store/allocationStore'
import { Routes, Route, useLocation } from 'react-router'
import Home from './pages/Home'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import Navbar from './components/Navbar'
import LuminousBackground from './components/LuminousBackground'
import ErrorBoundary from './components/ErrorBoundary'

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

// 兼容旧路由：/allocation/result 重定向到新的配置中心
const LegacyAllocationDashboard = lazy(() => import('./pages/LegacyAllocationDashboard'))

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

export default function App() {
  return (
    <div className="relative min-h-screen">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-[#3B6CFF] focus:text-white focus:text-sm focus:shadow-lg">
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
            <Route path="/:id" element={<FundDetail />} />
            <Route path="/backtest" element={<Backtest />} />
            <Route path="/recommend" element={<Recommend />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/login" element={<Login />} />

            {/* 资产配置向导 */}
            <Route path="/allocation" element={<AllocationProvider><AllocationWizard /></AllocationProvider>} />

            {/* 智能配置 — 侧边导航常驻 + 子路由 */}
            <Route path="/allocation/result" element={<AllocationProvider><AllocationLayout /></AllocationProvider>}>
              <Route index element={<OverviewPage />} />
              <Route path="market" element={<MarketPage />} />
              <Route path="strategy" element={<StrategyPage />} />
              <Route path="funds" element={<FundsPage />} />
              <Route path="risk" element={<RiskPage />} />
              <Route path="ops" element={<OpsPage />} />
              <Route path="plans" element={<PlansPage />} />
              <Route path="simulator" element={<SimulatorPage />} />
              <Route path="backtest" element={<BacktestPage />} />
            </Route>

            {/* 兼容旧路由 */}
            <Route path="/allocation/:id" element={<LegacyAllocationDashboard />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
