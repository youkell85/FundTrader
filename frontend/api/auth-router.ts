import * as cookie from "cookie";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Session } from "@contracts/constants";
import { createRouter, publicQuery } from "./middleware";
import { loginViaBackend, registerViaBackend, syncSession, deleteSession } from "./lib/user-store";
import { ftFetch } from "./lib/fundtrader-client";

function cookieOptions(headers: Headers, maxAge?: number) {
  const host = headers.get("host") || "";
  const localhost = host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: proto === "https" && !localhost,
    maxAge,
  };
}

function setSessionCookie(headers: Headers, token: string) {
  headers.append(
    "Set-Cookie",
    cookie.serialize(Session.cookieName, token, cookieOptions(headers, Session.maxAgeMs / 1000)),
  );
}

function clearSessionCookie(headers: Headers) {
  headers.append(
    "Set-Cookie",
    cookie.serialize(Session.cookieName, "", cookieOptions(headers, 0)),
  );
}

function requireUser(ctx: { user?: { id: string } }) {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
  }
  return ctx.user;
}

const credentialsSchema = z.object({
  username: z.string().min(3, "用户名至少3位").max(32, "用户名最多32位"),
  password: z.string().min(8, "密码至少8位").max(128, "密码过长"),
});

export const authRouter = createRouter({
  me: publicQuery.query(({ ctx }) => ctx.user ?? null),

  register: publicQuery
    .input(credentialsSchema.extend({
      displayName: z.string().max(64).optional(),
      email: z.string().email("请输入有效邮箱"),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const res = await registerViaBackend(input);
        syncSession(res.token, res.user.id, Session.maxAgeMs);
        setSessionCookie(ctx.resHeaders, res.token);
        return { id: res.user.id, name: res.user.displayName, username: res.user.username, role: res.user.role || "user", avatar: null };
      } catch (err: any) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err?.message || "注册失败" });
      }
    }),

  login: publicQuery
    .input(credentialsSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const res = await loginViaBackend(input.username, input.password);
        syncSession(res.token, res.user.id, Session.maxAgeMs);
        setSessionCookie(ctx.resHeaders, res.token);
        return { id: res.user.id, name: res.user.displayName, username: res.user.username, role: res.user.role || "user", avatar: null };
      } catch (err: any) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: err?.message || "登录失败" });
      }
    }),

  forgotPassword: publicQuery
    .input(z.object({ username: z.string(), email: z.string().email() }))
    .mutation(async ({ input }) => {
      try {
        const res = await ftFetch<{ message: string }>("/auth/forgot-password", {
          method: "POST", body: JSON.stringify(input),
        });
        return res;
      } catch (err: any) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err?.message || "发送失败" });
      }
    }),

  logout: publicQuery.mutation(async ({ ctx }) => {
    if (ctx.sessionToken) {
      deleteSession(ctx.sessionToken);
      await ftFetch("/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${ctx.sessionToken}` } }).catch(() => {});
    }
    clearSessionCookie(ctx.resHeaders);
    return { success: true };
  }),

  state: publicQuery.query(({ ctx }) => {
    requireUser(ctx);
    return { watchlistCodes: [], backtestRecords: [], recommendationRecords: [], preferences: {}, recentFunds: [] };
  }),

  savePreferences: publicQuery
    .input(z.record(z.string(), z.unknown()))
    .mutation(({ input, ctx }) => {
      requireUser(ctx);
      return { preferences: input };
    }),
});
