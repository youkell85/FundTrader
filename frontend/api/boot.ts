import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

// Image search proxy: forwards base64 JSON to FastAPI backend
const API_BASE = process.env.FUNDTRADER_API_BASE || "http://localhost:8766";
app.post("/api/image-search", async (c) => {
  try {
    const body = await c.req.json();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`${API_BASE}/fund/image-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await res.json();
      return c.json(data);
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "识别服务异常";
    return c.json({ success: false, error: message }, 500);
  }
});

// tRPC routes
app.use("/fund/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/fund/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});

// REST API proxy: forward non-tRPC /fund/api/* requests to FastAPI backend
app.all("/fund/api/*", async (c) => {
  try {
    const url = new URL(c.req.url);
    const backendPath = url.pathname.replace(/^\/fund\/api/, "");
    const targetUrl = `${API_BASE}${backendPath}${url.search}`;
    const headers: Record<string, string> = {};
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      headers["Content-Type"] = "application/json";
    }
    const method = c.req.method;
    let body: string | undefined;
    if (method !== "GET" && method !== "HEAD") {
      try { body = await c.req.text(); } catch { body = undefined; }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(targetUrl, { method, headers, body, signal: controller.signal });
      const data = await res.text();
      return c.body(data, res.status as any, { "Content-Type": "application/json" });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "API proxy error";
    return c.json({ error: message }, 502);
  }
});

// Static files - MUST be before SPA fallback
const distPath = path.resolve(import.meta.dirname, "../dist/public");

app.use("/fund/assets/*", serveStatic({
  root: distPath,
  rewriteRequestPath: (p) => p.replace(/^\/fund/, "") || "/",
}));

const indexHtml = fs.existsSync(path.resolve(distPath, "index.html"))
  ? fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8")
  : null;

// Redirect /fund -> /fund/ for consistent routing
app.get("/fund", (c) => c.redirect("/fund/"));

// SPA fallback: serve index.html for all non-API routes under /fund/
app.get("/fund/*", (c) => {
  if (indexHtml) return c.html(indexHtml);
  return c.json({ error: "Not Found" }, 404);
});

app.use("*", serveStatic({
  root: distPath,
  rewriteRequestPath: (p) => p.replace(/^\/fund/, "") || "/",
}));

app.notFound((c) => {
  const accept = c.req.header("accept") ?? "";
  if (accept.includes("application/json") && !accept.includes("text/html")) {
    return c.json({ error: "Not Found" }, 404);
  }
  if (indexHtml) return c.html(indexHtml);
  return c.json({ error: "Not Found" }, 404);
});

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
