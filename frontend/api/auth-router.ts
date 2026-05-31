import * as cookie from "cookie";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Session } from "@contracts/constants";
import { createRouter, publicQuery } from "./middleware";
import { ftFetch } from "./lib/fundtrader-client";

function cookieOptions(headers: Headers, maxAge?: number) {
  const host = headers.get("host") || "";
  const localhost = host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: !localhost,
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
  password: z.string().min(6, "密码至少6位").max(128, "密码过长"),
});

export const authRouter = createRouter({
  me: publicQuery.query(({ ctx }) => ctx.user ?? null),

  register: publicQuery
    .input(credentialsSchema.extend({
      displayName: z.string().max(64).optional(),
      email: z.string().email().optional().or(z.literal("")),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const res = await ftFetch<{ user: any; token: string }>("/auth/register", {
          method: "POST",
          body: JSON.stringify(input),
        });
        setSessionCookie(ctx.resHeaders, res.token);
        return { id: res.user.id, name: res.user.displayName, username: res.user.username, role: res.user.role, avatar: null };
      } catch (err: any) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err?.message || "注册失败" });
      }
    }),

  login: publicQuery
    .input(credentialsSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const res = await ftFetch<{ user: any; token: string }>("/auth/login", {
          method: "POST",
          body: JSON.stringify(input),
        });
        setSessionCookie(ctx.resHeaders, res.token);
        return { id: res.user.id, name: res.user.displayName, username: res.user.username, role: res.user.role, avatar: null };
      } catch (err: any) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: err?.message || "登录失败" });
      }
    }),

  logout: publicQuery.mutation(async ({ ctx }) => {
    if (ctx.sessionToken) {
      await ftFetch("/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${ctx.sessionToken}` },
      }).catch(() => {});
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
