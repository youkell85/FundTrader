import * as cookie from "cookie";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Session } from "@contracts/constants";
import { createRouter, publicQuery } from "./middleware";
import {
  createSession,
  deleteSession,
  getUserState,
  loginUser,
  registerUser,
  updateUserState,
} from "./lib/user-store";

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
    .mutation(({ input, ctx }) => {
      try {
        const user = registerUser(input);
        const token = createSession(user.id, Session.maxAgeMs);
        setSessionCookie(ctx.resHeaders, token);
        return user;
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "注册失败",
        });
      }
    }),

  login: publicQuery
    .input(credentialsSchema)
    .mutation(({ input, ctx }) => {
      try {
        const user = loginUser(input.username, input.password);
        const token = createSession(user.id, Session.maxAgeMs);
        setSessionCookie(ctx.resHeaders, token);
        return user;
      } catch (err) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: err instanceof Error ? err.message : "登录失败",
        });
      }
    }),

  logout: publicQuery.mutation(({ ctx }) => {
    if (ctx.sessionToken) deleteSession(ctx.sessionToken);
    clearSessionCookie(ctx.resHeaders);
    return { success: true };
  }),

  state: publicQuery.query(({ ctx }) => {
    const user = requireUser(ctx);
    return getUserState(user.id);
  }),

  savePreferences: publicQuery
    .input(z.record(z.string(), z.unknown()))
    .mutation(({ input, ctx }) => {
      const user = requireUser(ctx);
      return updateUserState(user.id, { preferences: input });
    }),
});
