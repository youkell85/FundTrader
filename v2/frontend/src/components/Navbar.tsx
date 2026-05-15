import { Link, useLocation } from "react-router";
import { TrendingUp, BarChart3, Calculator, Lightbulb, LogIn, LogOut, User } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useState } from "react";

const navItems = [
  { path: "/", label: "基金市场", icon: TrendingUp },
  { path: "/backtest", label: "智能定投", icon: Calculator },
  { path: "/recommend", label: "配置推荐", icon: Lightbulb },
  { path: "/analysis", label: "深度分析", icon: BarChart3 },
];

export default function Navbar() {
  const location = useLocation();
  const { user, logout, isLoading } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);

  return (
    <nav className="liquid-glass-nav fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-6">
      <div className="flex items-center gap-8">
        <Link to="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#3B6CFF] to-[#00F0FF] flex items-center justify-center">
            <span className="text-white font-bold text-sm">元</span>
          </div>
          <span className="text-white font-semibold text-base tracking-tight group-hover:text-[#00F0FF] transition-colors">
            元选 <span className="text-white/40 font-normal text-sm">YuanXuan</span>
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                  isActive
                    ? "text-[#00F0FF] bg-white/5"
                    : "text-white/60 hover:text-white/90 hover:bg-white/[0.03]"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
                {isActive && (
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-gradient-to-r from-[#3B6CFF] to-[#00F0FF] rounded-full" />
                )}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {isLoading ? (
          <div className="w-6 h-6 rounded-full border border-white/20 border-t-white/60 animate-spin" />
        ) : user ? (
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#3B6CFF] to-[#00F0FF] flex items-center justify-center">
                <User className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-white/80 text-sm">{user.name || "用户"}</span>
            </button>
            {showUserMenu && (
              <div className="absolute right-0 top-full mt-2 w-44 liquid-glass-sm py-2 z-50">
                <div className="px-3 py-2 text-xs text-white/40 border-b border-white/5">客户经理工作台</div>
                <button
                  onClick={() => { logout(); setShowUserMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  退出登录
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link
            to="/login"
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 transition-all"
          >
            <LogIn className="w-3.5 h-3.5" />
            登录
          </Link>
        )}
      </div>
    </nav>
  );
}
