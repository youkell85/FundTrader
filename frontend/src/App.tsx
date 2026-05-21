import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import Navbar from './components/Navbar'
import LuminousBackground from './components/LuminousBackground'

// 路由级代码分割：详情/回测/分析/推荐页依赖 recharts（charts-vendor 428KB），
// 懒加载可避免首页首屏预加载这些重型图表库
const FundDetail = lazy(() => import('./pages/FundDetail'))
const Backtest = lazy(() => import('./pages/Backtest'))
const Recommend = lazy(() => import('./pages/Recommend'))
const Analysis = lazy(() => import('./pages/Analysis'))

function PageLoader() {
  return (
    <div className="min-h-screen pt-14 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
    </div>
  )
}

export default function App() {
  return (
    <div className="relative min-h-screen">
      <LuminousBackground />
      <div className="relative z-10 pb-16 md:pb-0">
        <Navbar />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/:id" element={<FundDetail />} />
            <Route path="/backtest" element={<Backtest />} />
            <Route path="/recommend" element={<Recommend />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  )
}
