import { authRouter } from "./auth-router";
import { fundRouter } from "./fund-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  fund: fundRouter,
});

export type AppRouter = typeof appRouter;
