import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { Loader2, LogIn, UserPlus, Mail } from "lucide-react";
import { trpc } from "@/providers/trpc";

export default function Login() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const onSuccess = async () => {
    await utils.auth.me.invalidate();
    navigate("/");
  };
  const login = trpc.auth.login.useMutation({ onSuccess });
  const register = trpc.auth.register.useMutation({
    onSuccess: () => {
      setSuccess("注册成功！请检查邮箱完成验证。");
      setMode("login");
    },
  });
  const forgotPw = trpc.auth.forgotPassword.useMutation({
    onSuccess: (data: any) => setSuccess(data?.message || "新密码已发送"),
    onError: (err: any) => setError(err.message),
  });
  const pending = login.isPending || register.isPending || forgotPw.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (mode === "login") {
      login.mutate({ username: username.trim(), password }, { onError: (err: any) => setError(err.message) });
    } else if (mode === "register") {
      if (!email.includes("@")) { setError("请输入有效的邮箱地址"); return; }
      register.mutate({
        username: username.trim(), password, email: email.trim(),
        displayName: displayName.trim() || username.trim(),
      }, { onError: (err: any) => setError(err.message) });
    } else {
      forgotPw.mutate({ username: username.trim(), email: email.trim() });
    }
  };

  return (
    <div className="min-h-screen pt-14 flex items-center justify-center px-4">
      <div className="w-full max-w-sm liquid-glass p-5 md:p-6">
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-white">
            {mode === "login" ? "登录 FundTrader" : mode === "register" ? "注册 FundTrader" : "忘记密码"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-white/50">
            {mode === "forgot" ? "输入用户名和注册邮箱，新密码将发送到你的邮箱。" : "登录后会保存自选基金、智能定投方案、回测历史和组合配置记录。"}
          </p>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2">
          <button onClick={() => { setMode("login"); setError(""); setSuccess(""); }} className={`h-9 rounded-lg border text-sm ${mode === "login" ? "border-[#00F0FF]/35 bg-[#00F0FF]/12 text-[#00F0FF]" : "border-white/[0.06] bg-white/[0.03] text-white/45"}`}>登录</button>
          <button onClick={() => { setMode("register"); setError(""); setSuccess(""); }} className={`h-9 rounded-lg border text-sm ${mode === "register" ? "border-[#00F0FF]/35 bg-[#00F0FF]/12 text-[#00F0FF]" : "border-white/[0.06] bg-white/[0.03] text-white/45"}`}>注册</button>
          <button onClick={() => { setMode("forgot"); setError(""); setSuccess(""); }} className={`h-9 rounded-lg border text-sm ${mode === "forgot" ? "border-[#00F0FF]/35 bg-[#00F0FF]/12 text-[#00F0FF]" : "border-white/[0.06] bg-white/[0.03] text-white/45"}`}>忘记密码</button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="用户名" autoComplete="username"
            className="h-11 w-full rounded-lg border border-white/[0.08] bg-[#0B1021] px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#3B6CFF]/50" />

          {(mode === "register" || mode === "forgot") && (
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" type="email" autoComplete="email"
              className="h-11 w-full rounded-lg border border-white/[0.08] bg-[#0B1021] px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#3B6CFF]/50" />
          )}

          {mode === "register" && (
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="显示名称（可选）"
              className="h-11 w-full rounded-lg border border-white/[0.08] bg-[#0B1021] px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#3B6CFF]/50" />
          )}

          {mode !== "forgot" && (
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className="h-11 w-full rounded-lg border border-white/[0.08] bg-[#0B1021] px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#3B6CFF]/50" />
          )}

          {error && <div className="text-xs text-[#FF3366]">{error}</div>}
          {success && <div className="text-xs text-[#16C784]">{success}</div>}

          <button type="submit" disabled={pending}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#3B6CFF] to-[#2A52CC] text-sm font-medium text-white disabled:opacity-45">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> :
             mode === "login" ? <LogIn className="h-4 w-4" /> :
             mode === "register" ? <UserPlus className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
            {mode === "login" ? "登录" : mode === "register" ? "注册并登录" : "发送重置邮件"}
          </button>
        </form>
      </div>
    </div>
  );
}
