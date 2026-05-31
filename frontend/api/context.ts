import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import * as cookie from "cookie";
import { Session } from "@contracts/constants";
import { getUserBySession, type PublicUser } from "./lib/user-store";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: PublicUser;
  sessionToken?: string;
};

export function createContext(
  opts: FetchCreateContextFnOptions,
): TrpcContext {
  const cookies = cookie.parse(opts.req.headers.get("cookie") || "");
  const sessionToken = cookies[Session.cookieName];
  const user = getUserBySession(sessionToken) || undefined;
  return { req: opts.req, resHeaders: opts.resHeaders, user, sessionToken };
}
