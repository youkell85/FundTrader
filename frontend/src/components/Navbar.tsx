import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import {
  BarChart3,
  Bell,
  BriefcaseBusiness,
  Calculator,
  Lightbulb,
  LogIn,
  LogOut,
  PieChart,
  Search,
  Shield,
  TrendingUp,
  User,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useAlertNotifications } from '@/hooks/useAlertNotifications'
import { cn } from '@/lib/utils'

const navItems = [
  { path: '/', label: '市场', icon: TrendingUp },
  { path: '/backtest', label: '定投', icon: Calculator },
  { path: '/recommend', label: '组合', icon: Lightbulb },
  { path: '/allocation', label: '配置', icon: PieChart },
  { path: '/analysis', label: '研究', icon: Search },
  { path: '/workspace', label: '机构', icon: BriefcaseBusiness },
]

function isRouteActive(pathname: string, itemPath: string) {
  if (itemPath === '/') return pathname === '/'
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`)
}

export default function Navbar() {
  const location = useLocation()
  const { user, logout, isLoading } = useAuth()
  const { unreadCount, criticalCount } = useAlertNotifications({ enabled: !!user })
  const [showUserMenu, setShowUserMenu] = useState(false)

  return (
    <>
      <nav className="liquid-glass-nav fixed left-0 right-0 top-0 z-50 flex h-12 items-center justify-between px-3 md:px-6">
        <div className="flex min-w-0 items-center gap-5 md:gap-8">
          <Link to="/" className="group flex shrink-0 items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-md border border-primary/30 bg-primary/[0.18] text-primary shadow-[0_0_18px_rgba(69,176,132,0.18)]">
              <BarChart3 className="h-4 w-4" />
            </div>
            <div className="leading-none">
              <div className="text-sm font-semibold tracking-tight text-white/[0.92] group-hover:text-white">FundTrader</div>
              <div className="hidden text-[10px] text-white/[0.34] sm:block">资产驾驶舱</div>
            </div>
          </Link>

          <div className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = isRouteActive(location.pathname, item.path)
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    'workspace-nav-item relative flex h-8 items-center gap-1.5 px-3 text-sm font-medium',
                    isActive && 'workspace-nav-item-active',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              )
            })}
            {user?.role === 'admin' && (
              <Link
                to="/admin"
                className={cn(
                  'workspace-nav-item relative flex h-8 items-center gap-1.5 px-3 text-sm font-medium',
                  location.pathname.startsWith('/admin') && 'border-accent/25 bg-accent/[0.12] text-accent',
                )}
              >
                <Shield className="h-3.5 w-3.5" />
                管理
              </Link>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          {user && unreadCount > 0 && (
            <button
              type="button"
              aria-label={`通知：${unreadCount} 条未读`}
              className="relative hidden rounded-lg p-1.5 text-white/[0.58] transition hover:bg-white/[0.04] hover:text-white md:block"
            >
              <Bell className="h-4 w-4" aria-hidden="true" />
              <span
                className={cn(
                  'absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white',
                  criticalCount > 0 ? 'bg-destructive' : 'bg-accent',
                )}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            </button>
          )}

          {isLoading ? (
            <div className="h-6 w-6 animate-spin rounded-full border border-white/20 border-t-white/60" />
          ) : user ? (
            <div className="relative">
              <button
                type="button"
                aria-label="用户菜单"
                aria-expanded={showUserMenu}
                aria-haspopup="menu"
                onClick={() => setShowUserMenu((value) => !value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setShowUserMenu(false)
                }}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-white/[0.72] transition hover:bg-white/[0.04] hover:text-white focus-visible:ring-2 focus-visible:ring-primary/50 md:px-3"
              >
                <div className="grid h-6 w-6 place-items-center rounded-md bg-primary/[0.16] text-primary">
                  <User className="h-3.5 w-3.5" aria-hidden="true" />
                </div>
                <span className="hidden text-sm sm:inline">{user.name || user.username || '用户'}</span>
              </button>
              {showUserMenu && (
                <div role="menu" className="surface-elevated absolute right-0 top-full z-50 mt-2 w-48 py-2">
                  <div className="border-b border-white/5 px-3 py-2 text-xs text-white/40">账户与个人数据</div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      logout()
                      setShowUserMenu(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-white/[0.68] transition hover:bg-white/[0.04] hover:text-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    退出登录
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              to="/login"
              className="flex items-center gap-1.5 rounded-md border border-white/[0.07] bg-white/[0.045] px-3 py-2 text-sm font-medium text-white/70 transition hover:bg-primary/[0.12] hover:text-white md:px-4"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">登录</span>
            </Link>
          )}
        </div>
      </nav>

      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/[0.075] bg-[#050706]/94 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        <div className="grid grid-cols-6 px-1 py-1.5">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = isRouteActive(location.pathname, item.path)
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'flex h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] transition',
                  isActive ? 'bg-primary/10 text-primary' : 'text-white/[0.42] active:bg-white/[0.04]',
                )}
              >
                <div className="relative">
                  <Icon className="h-4 w-4" />
                  {item.path === '/allocation' && unreadCount > 0 && (
                    <span
                      className={cn(
                        'absolute -right-2 -top-1 flex h-3 min-w-3 items-center justify-center rounded-full px-0.5 text-[8px] font-bold text-white',
                        criticalCount > 0 ? 'bg-destructive' : 'bg-accent',
                      )}
                    >
                      {unreadCount}
                    </span>
                  )}
                </div>
                <span className="hidden min-[375px]:block">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </div>
    </>
  )
}
