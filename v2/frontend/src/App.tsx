import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import FundDetail from './pages/FundDetail'
import Backtest from './pages/Backtest'
import Recommend from './pages/Recommend'
import Analysis from './pages/Analysis'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import Navbar from './components/Navbar'
import LuminousBackground from './components/LuminousBackground'

export default function App() {
  return (
    <div className="relative min-h-screen">
      <LuminousBackground />
      <div className="relative z-10">
        <Navbar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/fund/:id" element={<FundDetail />} />
          <Route path="/backtest" element={<Backtest />} />
          <Route path="/recommend" element={<Recommend />} />
          <Route path="/analysis" element={<Analysis />} />
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </div>
  )
}
