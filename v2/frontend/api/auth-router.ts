import { createRouter, authedQuery, publicQuery } from "./middleware";

export const authRouter = createRouter({
  me: publicQuery.query(() => ({
    id: 1,
    name: "管理员",
    email: "admin@fundtrader.com",
    role: "admin",
    avatar: null,
  })),
  logout: publicQuery.mutation(() => ({ success: true })),
});
