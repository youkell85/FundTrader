import { useState, useCallback } from 'react';
import { NavLink, useLocation, matchPath } from 'react-router';
import {
  LayoutDashboard,
  Wrench,
  FolderOpen,
  FlaskConical,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  PlayCircle,
} from 'lucide-react';

interface NavItem {
  label: string;
  path: string;
  icon: typeof LayoutDashboard;
  children?: { label: string; path: string }[];
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
  { label: '模拟器', path: '/allocation/result/simulator', icon: FlaskConical },
  { label: '回测中心', path: '/allocation/result/backtest', icon: TrendingUp },
];

function isActive(parentPath: string, pathname: string): boolean {
  if (parentPath === '/allocation/result') {
    return !!matchPath({ path: '/allocation/result/*', end: false }, pathname);
  }
  return !!matchPath({ path: parentPath, end: false }, pathname);
}

export default function SidebarNav() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(
    location.pathname.startsWith('/allocation/result') ? '/allocation/result' : null
  );

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const toggleGroup = (path: string) => {
    setExpandedGroup((prev) => (prev === path ? null : path));
  };

  return (
    <>
      {/* Mobile toggle */}
      <button
        aria-label={mobileOpen ? '关闭菜单' : '打开菜单'}
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen(!mobileOpen)}
        className="md:hidden fixed top-16 left-4 z-50 p-2 rounded-lg bg-white/[0.08] backdrop-blur-md border border-white/[0.06] text-white/70 focus-visible:ring-2 focus-visible:ring-[#3B6CFF]/50"
      >
        {mobileOpen ? <X className="w-5 h-5" aria-hidden="true" /> : <Menu className="w-5 h-5" aria-hidden="true" />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen ? (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/50"
          onClick={closeMobile}
        />
      ) : null}

      {/* Sidebar */}
      <aside
        className={`fixed md:sticky top-12 left-0 z-40 h-[calc(100vh-3rem)] bg-[#08080C]/92 backdrop-blur-xl border-r border-white/[0.04] transition-all duration-300 ${
          collapsed ? 'w-16' : 'w-52'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.04]">
          {!collapsed && <span className="text-[10px] font-medium text-white/25 uppercase tracking-wider">资产配置</span>}
          <button
            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
            className="hidden md:flex p-1 rounded hover:bg-white/[0.06] text-white/40 focus-visible:ring-2 focus-visible:ring-[#3B6CFF]/50"
          >
           {collapsed ? <ChevronRight className="w-4 h-4" aria-hidden="true" /> : <ChevronLeft className="w-4 h-4" aria-hidden="true" />}
         </button>
       </div>
          {mobileOpen && (
            <button
              onClick={closeMobile}
              className="md:hidden ml-auto p-1 rounded hover:bg-white/[0.06] text-white/40"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}

        <nav className="p-2 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.path, location.pathname);
            const Icon = item.icon;
            const hasChildren = item.children && item.children.length > 0;
            const isExpanded = expandedGroup === item.path;

            return (
              <div key={item.path}>
                {hasChildren ? (
                  <button
                    aria-expanded={isExpanded}
                    onClick={() => toggleGroup(item.path)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors focus-visible:ring-2 focus-visible:ring-[#3B6CFF]/50 ${
                      active
                        ? 'text-white/90 bg-white/[0.04]'
                        : 'text-white/40 hover:bg-white/[0.03] hover:text-white/60'
                    }`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left">{item.label}</span>
                        <ChevronRight
                          className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        />
                      </>
                    )}
                  </button>
                ) : (
                  <NavLink
                    to={item.path}
                    onClick={closeMobile}
                    className={({ isActive: navActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                        navActive
                              ? 'text-white/90 bg-white/[0.04] border-l-2 border-primary/70 font-medium'
                              : 'text-white/40 hover:bg-white/[0.03] hover:text-white/60'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {!collapsed && <span>{item.label}</span>}
                  </NavLink>
                )}

                {/* Sub-nav */}
                {hasChildren && isExpanded && !collapsed && (
                  <div className="ml-4 mt-1 space-y-0.5 border-l border-white/[0.04] pl-2">
                    {item.children!.map((child) => (
                      <NavLink
                        key={child.path}
                        to={child.path}
                        onClick={closeMobile}
                        className={({ isActive: navActive }) =>
                          `block px-3 py-2 rounded-md text-xs transition-colors ${
                            navActive
                              ? 'text-white/85 bg-white/[0.03]'
                              : 'text-white/35 hover:text-white/55 hover:bg-white/[0.02]'
                          }`
                        }
                      >
                        {child.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
