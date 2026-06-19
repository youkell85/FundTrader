import { useState, useEffect } from "react";
import { Users, Shield, Activity, Database, Key, Clock, CheckCircle, XCircle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface AdminStats { total_users: number; active_sessions: number; fund_count: number; plan_count: number; recent_logins: { username: string; time: string }[] }
interface AdminUser { id: string; username: string; displayName: string; email: string; emailVerified: boolean; role: string; createdAt: string; activeSessions: number }

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const r1 = await fetch("/fund/api/admin/stats", { credentials: "include" });
      if (r1.ok) setStats(await r1.json());
      const r2 = await fetch("/fund/api/admin/users", { credentials: "include" });
      if (r2.ok) { const d = await r2.json(); setUsers(d.users || []); }
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    await fetch(`/fund/api/admin/users/${userId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ role }),
    });
    fetchData();
  };

  if (loading) return <div className="min-h-screen pt-14 flex items-center justify-center"><div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen pt-14 px-4 pb-20">
      <div className="max-w-6xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-3"><Shield className="w-6 h-6 text-[#FFB800]" />管理员控制台</h1>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={<Users className="w-5 h-5" />} label="用户总数" value={stats.total_users} color="#3B6CFF" />
            <StatCard icon={<Activity className="w-5 h-5" />} label="活跃会话" value={stats.active_sessions} color="#16C784" />
            <StatCard icon={<Database className="w-5 h-5" />} label="基金池" value={stats.fund_count} color="#FFB800" />
            <StatCard icon={<Key className="w-5 h-5" />} label="配置方案" value={stats.plan_count} color="#9D7BFF" />
          </div>
        )}

        {/* User Management */}
        <div className="liquid-glass p-5">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><Users className="w-5 h-5 text-[#3B6CFF]" />用户管理</h2>
          {error && <div className="text-xs text-red-400 mb-3">{error}</div>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-white/40 text-left border-b border-white/[0.06]">
                <th className="py-2 px-2">用户名</th><th className="py-2 px-2">显示名</th><th className="py-2 px-2">邮箱</th>
                <th className="py-2 px-2">验证</th><th className="py-2 px-2">角色</th><th className="py-2 px-2">会话</th>
                <th className="py-2 px-2">注册时间</th><th className="py-2 px-2">操作</th>
              </tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                    <td className="py-2 px-2 text-white/80">{u.username}</td>
                    <td className="py-2 px-2 text-white/60">{u.displayName}</td>
                    <td className="py-2 px-2 text-white/50 text-xs">{u.email || "—"}</td>
                    <td className="py-2 px-2">{u.emailVerified ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-white/20" />}</td>
                    <td className="py-2 px-2">
                      <Select value={u.role} onValueChange={(role) => handleRoleChange(u.id, role)}>
                        <SelectTrigger className="h-8 w-[92px] rounded bg-[#0B1021] border-white/[0.08] px-2 py-1 text-xs text-white/70">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-popover text-popover-foreground border-white/[0.08]">
                          <SelectItem value="user">user</SelectItem>
                          <SelectItem value="admin">admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 px-2 text-white/50">{u.activeSessions}</td>
                    <td className="py-2 px-2 text-white/40 text-xs">{u.createdAt?.slice(0, 10)}</td>
                    <td className="py-2 px-2">
                      <button onClick={() => setSelectedUser(u)} className="text-xs text-[#5AA9FF] hover:underline">详情</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Logins */}
        {stats?.recent_logins && stats.recent_logins.length > 0 && (
          <div className="liquid-glass p-5">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><Clock className="w-5 h-5 text-[#16C784]" />最近登录</h2>
            <div className="space-y-2">
              {stats.recent_logins.map((l, i) => (
                <div key={i} className="flex items-center justify-between text-sm"><span className="text-white/70">{l.username}</span><span className="text-white/40 text-xs">{l.time?.slice(0, 19)}</span></div>
              ))}
            </div>
          </div>
        )}

        {/* User Detail Modal */}
        {selectedUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setSelectedUser(null)}>
            <div className="liquid-glass p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-white mb-4">{selectedUser.username} 的详情</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-white/40">ID</span><span className="text-white/70 text-xs">{selectedUser.id}</span></div>
                <div className="flex justify-between"><span className="text-white/40">用户名</span><span className="text-white/70">{selectedUser.username}</span></div>
                <div className="flex justify-between"><span className="text-white/40">显示名</span><span className="text-white/70">{selectedUser.displayName}</span></div>
                <div className="flex justify-between"><span className="text-white/40">邮箱</span><span className="text-white/70">{selectedUser.email || "—"}</span></div>
                <div className="flex justify-between"><span className="text-white/40">邮箱验证</span><span className="text-white/70">{selectedUser.emailVerified ? "✅" : "❌"}</span></div>
                <div className="flex justify-between"><span className="text-white/40">角色</span><span className="text-white/70">{selectedUser.role}</span></div>
                <div className="flex justify-between"><span className="text-white/40">活跃会话</span><span className="text-white/70">{selectedUser.activeSessions}</span></div>
                <div className="flex justify-between"><span className="text-white/40">注册时间</span><span className="text-white/70 text-xs">{selectedUser.createdAt}</span></div>
              </div>
              <button onClick={() => setSelectedUser(null)} className="mt-4 w-full h-10 rounded-lg bg-white/[0.06] text-white/60 text-sm hover:bg-white/[0.1]">关闭</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="liquid-glass-sm p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${color}15`, color }}>{icon}</div>
      <div><div className="text-2xl font-bold text-white">{value}</div><div className="text-xs text-white/40">{label}</div></div>
    </div>
  );
}
