import { useCallback, useState } from 'react'
import { matchPath, NavLink, useLocation } from 'react-router'
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  FlaskConical,
  LayoutDashboard,
  Menu,
  PlayCircle,
  TrendingUp,
  Wrench,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItem {
  label: string
  path: string
  icon: typeof LayoutDashboard
  children?: { label: string; path: string }[]
}

const NAV_ITEMS: NavItem[] = [
  {
    label: '配置中心',
    path: '/allocation/result',
    icon: LayoutDashboard,
    children: [
      { label: '总览', path: '/allocation/result' },
      { label: '市场洞察', path: '/allocation/result/market' },
      { label: '策略配置', path: '/allocation/result/strategy' },
      { label: '基金研究', path: '/allocation/result/funds' },
      { label: '风险管理', path: '/allocation/result/risk' },
    ],
  },
  { label: '执行计划', path: '/allocation/result/execute', icon: PlayCircle },
  { label: '运维工具', path: '/allocation/result/ops', icon: Wrench },
  { label: '方案管理', path: '/allocation/result/plans', icon: FolderOpen },
  { label: '方案模拟', path: '/allocation/result/simulator', icon: FlaskConical },
  { label: '回测中心', path: '/allocation/result/backtest', icon: TrendingUp },
]

function isActive(parentPath: string, pathname: string): boolean {
  if (parentPath === '/allocation/result') {
    return !!matchPath({ path: '/allocation/result/*', end: false }, pathname)
  }
  return !!matchPath({ path: parentPath, end: false }, pathname)
}

export default function SidebarNav() {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(
    location.pathname.startsWith('/allocation/result') ? '/allocation/result' : null,
  )

  const closeMobile = useCallback(() => setMobileOpen(false), [])

  const toggleGroup = (path: string) => {
    setExpandedGroup((prev) => (prev === path ? null : path))
  }

  return (
    <>
      <button
        type="button"
        aria-label={mobileOpen ? '关闭配置导航' : '打开配置导航'}
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((value) => !value)}
        className="fixed left-4 top-16 z-50 rounded-lg border border-white/[0.07] bg-white/[0.06] p-2 text-white/70 backdrop-blur-md focus-visible:ring-2 focus-visible:ring-primary/50 md:hidden"
      >
        {mobileOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
      </button>

      {mobileOpen ? <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={closeMobile} /> : null}

      <aside
        className={cn(
          'fixed left-0 top-12 z-40 h-[calc(100vh-3rem)] border-r border-white/[0.06] bg-[#050706]/95 backdrop-blur-xl transition-none md:sticky md:transition-all md:duration-300',
          collapsed ? 'w-16' : 'w-56',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        <div className="flex items-center justify-between border-b border-white/[0.055] px-3 py-3">
          {!collapsed && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary/[0.78]">Allocation</div>
              <div className="mt-0.5 text-xs text-white/[0.38]">资产驾驶舱</div>
            </div>
          )}
          <button
            type="button"
            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
            className="hidden rounded-md p-1 text-white/[0.42] transition hover:bg-white/[0.05] hover:text-white focus-visible:ring-2 focus-visible:ring-primary/50 md:flex"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : <ChevronLeft className="h-4 w-4" aria-hidden="true" />}
          </button>
          {mobileOpen && (
            <button type="button" onClick={closeMobile} className="rounded-md p-1 text-white/[0.42] transition hover:bg-white/[0.05] hover:text-white md:hidden">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        <nav className="space-y-1 p-2">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.path, location.pathname)
            const Icon = item.icon
            const hasChildren = Boolean(item.children?.length)
            const isExpanded = expandedGroup === item.path

            return (
              <div key={item.path}>
                {hasChildren ? (
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => toggleGroup(item.path)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-primary/50',
                      active ? 'workspace-nav-item-active' : 'workspace-nav-item',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left">{item.label}</span>
                        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-90')} />
                      </>
                    )}
                  </button>
                ) : (
                  <NavLink
                    to={item.path}
                    onClick={closeMobile}
                    className={({ isActive: navActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-primary/50',
                        navActive ? 'workspace-nav-item-active font-medium' : 'workspace-nav-item',
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!collapsed && <span>{item.label}</span>}
                  </NavLink>
                )}

                {hasChildren && isExpanded && !collapsed && (
                  <div className="ml-4 mt-1 space-y-0.5 border-l border-white/[0.06] pl-2">
                    {item.children!.map((child) => (
                      <NavLink
                        key={child.path}
                        to={child.path}
                        onClick={closeMobile}
                        className={({ isActive: navActive }) =>
                          cn(
                            'block rounded-md px-3 py-2 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-primary/50',
                            navActive ? 'bg-primary/10 text-primary' : 'text-white/40 hover:bg-white/[0.035] hover:text-white/[0.68]',
                          )
                        }
                      >
                        {child.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
      </aside>
    </>
  )
}
