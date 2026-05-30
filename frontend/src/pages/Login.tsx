import { useState } from "react";
import { useNavigate } from "react-router";
import { Loader2, LogIn, UserPlus } from "lucide-react";
import { trpc } from "@/providers/trpc";

export default function Login() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");

  const onSuccess = async () => {
    await utils.auth.me.invalidate();
    navigate("/");
  };
  const login = trpc.auth.login.useMutation({ onSuccess });
  const register = trpc.auth.register.useMutation({ onSuccess });
  const pending = login.isPending || register.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const payload = { username: username.trim(), password };
    if (mode === "login") {
      login.mutate(payload, { onError: (err) => setError(err.message) });
    } else {
      register.mutate({ ...payload, displayName: displayName.trim() || username.trim() }, {
        onError: (err) => setError(err.message),
      });
    }
  };

  return (
    <div className="min-h-screen pt-14 flex items-center justify-center px-4">
      <div className="w-full max-w-sm liquid-glass p-5 md:p-6">
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-white">{mode === "login" ? "登录 FundTrader" : "注册 FundTrader"}</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/50">
            登录后会保存自选基金、智能定投方案、回测历史和组合配置记录。
          </p>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            onClick={() => setMode("login")}
            className={`h-9 rounded-lg border text-sm ${mode === "login" ? "border-[#00F0FF]/35 bg-[#00F0FF]/12 text-[#00F0FF]" : "border-white/[0.06] bg-white/[0.03] text-white/45"}`}
          >
            登录
          </button>
          <button
            onClick={() => setMode("register")}
            className={`h-9 rounded-lg border text-sm ${mode === "register" ? "border-[#00F0FF]/35 bg-[#00F0FF]/12 text-[#00F0FF]" : "border-white/[0.06] bg-white/[0.03] text-white/45"}`}
          >
            注册
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="用户名"
            autoComplete="username"
            className="h-11 w-full rounded-lg border border-white/[0.08] bg-[#0B1021] px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#3B6CFF]/50"
          />
          {mode === "register" && (
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="显示名称（可选）"
              className="h-11 w-full rounded-lg border border-white/[0.08] bg-[#0B1021] px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#3B6CFF]/50"
            />
          )}
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="密码"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className="h-11 w-full rounded-lg border border-white/[0.08] bg-[#0B1021] px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#3B6CFF]/50"
          />
          {error && <div className="text-xs text-[#FF3366]">{error}</div>}
          <button
            type="submit"
            disabled={pending}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#3B6CFF] to-[#2A52CC] text-sm font-medium text-white disabled:opacity-45"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "login" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            {mode === "login" ? "登录" : "注册并登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
