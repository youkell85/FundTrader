import { Link, useLocation } from "react-router";
import { TrendingUp, Calculator, Lightbulb, PieChart, Search, Bell, LogIn, LogOut, User, Shield } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAlertNotifications } from "@/hooks/useAlertNotifications";
import { useState } from "react";

const navItems = [
  { path: "/", label: "基金市场", icon: TrendingUp },
  { path: "/backtest", label: "智能定投", icon: Calculator },
  { path: "/recommend", label: "配置组合", icon: Lightbulb },
  { path: "/allocation", label: "智能配置", icon: PieChart },
  { path: "/analysis", label: "基金研究", icon: Search },
];

export default function Navbar() {
  const location = useLocation();
  const { user, logout, isLoading } = useAuth();
  const { unreadCount, criticalCount } = useAlertNotifications({ enabled: !!user });
  const [showUserMenu, setShowUserMenu] = useState(false);

  return (
    <>
      <nav className="liquid-glass-nav fixed top-0 left-0 right-0 z-50 h-12 flex items-center justify-between px-3 md:px-6">
        <div className="flex items-center gap-8 min-w-0">
          <Link to="/" className="flex items-center gap-2 group shrink-0">
            <div className="w-6 h-6 rounded-sm bg-[#45B084] flex items-center justify-center shadow-[0_0_18px_rgba(69,176,132,0.22)]">
              <span className="text-white font-bold text-[10px]">基</span>
            </div>
            <span className="text-white/90 font-semibold text-sm tracking-tight group-hover:text-white transition-colors">
              鑫基荟<span className="hidden sm:inline text-white/30 font-normal text-xs ml-1">FundTrader</span>
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`relative flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                    isActive
                      ? "text-white/95"
                      : "text-white/45 hover:text-white/70 hover:bg-white/[0.03]"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.label}
                  {isActive && (
                    <div className="absolute bottom-0 left-3 right-3 h-px bg-[#45B084]" />
                  )}
                </Link>
              );
            })}
            {user?.role === "admin" && (
              <Link to="/admin" className={`relative flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${location.pathname.startsWith("/admin") ? "text-[#D69D63]/95" : "text-[#D69D63]/50 hover:text-[#D69D63]/70 hover:bg-white/[0.03]"}`}>
                <Shield className="w-3.5 h-3.5" />管理
                {location.pathname.startsWith("/admin") && <div className="absolute bottom-0 left-3 right-3 h-px bg-[#D69D63]" />}
              </Link>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          {/* Alert bell icon (desktop) */}
          {user && unreadCount > 0 && (
            <div className="relative hidden md:block">
              <button
                aria-label={`通知 ${unreadCount} 条未读`}
                className="relative p-1 rounded-lg hover:bg-white/5 transition-colors"
              >
                <Bell className="w-4 h-4 text-white/60" aria-hidden="true" />
                <span className={`absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
                  criticalCount > 0
                    ? "bg-red-500 text-white"
                    : "bg-[#D69D63] text-white"
                }`}>
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="w-6 h-6 rounded-full border border-white/20 border-t-white/60 animate-spin" />
          ) : user ? (
            <div className="relative">
              <button
                aria-label="用户菜单"
                aria-expanded={showUserMenu}
                aria-haspopup="menu"
                onClick={() => setShowUserMenu(!showUserMenu)}
                onKeyDown={(e) => { if (e.key === 'Escape') setShowUserMenu(false); }}
                className="flex items-center gap-2 px-2 md:px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors focus-visible:ring-2 focus-visible:ring-[#45B084]/50"
              >
                <div className="w-6 h-6 rounded-sm bg-[#45B084] flex items-center justify-center">
                  <User className="w-3.5 h-3.5 text-white" aria-hidden="true" />
                </div>
                <span className="hidden sm:inline text-white/80 text-sm">{user.name || "用户"}</span>
              </button>
              {showUserMenu && (
                <div role="menu" className="absolute right-0 top-full mt-2 w-44 surface-elevated py-2 z-50">
                  <div className="px-3 py-2 text-xs text-white/40 border-b border-white/5">个人数据已保存</div>
                  <button
                    role="menuitem"
                    onClick={() => { logout(); setShowUserMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#45B084]/50"
                  >
                    <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                    退出登录
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              to="/login"
              className="flex items-center gap-1.5 px-3 md:px-4 py-2 rounded-md text-sm font-medium text-white/70 hover:text-white bg-white/[0.055] hover:bg-[#45B084]/12 border border-white/[0.06] transition-all"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">登录</span>
            </Link>
          )}
        </div>
      </nav>

      {/* Mobile bottom navigation — 5 items + safe area */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-white/[0.075] bg-[#050706]/94 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5 px-1 py-1.5">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`h-12 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[11px] transition-all ${
                  isActive ? "text-[#8FD9BA] bg-[#45B084]/10" : "text-white/40 active:bg-white/[0.04]"
                }`}
              >
                <div className="relative">
                  <Icon className="w-4 h-4" />
                  {item.path === "/allocation" && unreadCount > 0 && (
                    <span className={`absolute -top-1 -right-2 min-w-[12px] h-3 px-0.5 rounded-full text-[8px] font-bold flex items-center justify-center ${
                      criticalCount > 0 ? "bg-red-500 text-white" : "bg-[#D69D63] text-white"
                    }`}>
                      {unreadCount}
                    </span>
                  )}
                </div>
                <span className="hidden min-[375px]:block">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
