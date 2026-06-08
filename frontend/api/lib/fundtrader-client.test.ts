import { afterEach, describe, expect, test, vi } from "vitest";
import { ftFetch } from "./fundtrader-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

describe("ftFetch", () => {
  test("parses backend JSON responses", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      text: async () => JSON.stringify({ status: "ok" }),
    }));
    globalThis.fetch = fetchMock as any;

    await expect(ftFetch<{ status: string }>("/health")).resolves.toEqual({ status: "ok" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8766/health");
    expect((init as RequestInit).headers).toMatchObject({ "Content-Type": "application/json" });
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  test("honors caller abort signals through the compatibility controller", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    globalThis.fetch = fetchMock as any;

    const callerController = new AbortController();
    const request = ftFetch("/fund/list", { signal: callerController.signal });

    callerController.abort(new Error("user cancelled"));

    await expect(request).rejects.toThrow("user cancelled");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
    expect((init as RequestInit).signal).not.toBe(callerController.signal);
  });
});
