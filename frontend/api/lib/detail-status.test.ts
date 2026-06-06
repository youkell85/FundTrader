import { describe, expect, test } from "vitest";
import {
  missingReason,
  realRows,
  deriveStatus,
  summarizeDetailCoverage,
  type CoverageEntry,
} from "@/lib/detail-status";

describe("detail status helpers", () => {
  test("allows available and partial rows", () => {
    expect(realRows({ dataStatus: "available", rows: [{ id: 1 }] })).toEqual([{ id: 1 }]);
    expect(realRows({ dataStatus: "partial", rows: [{ id: 2 }] })).toEqual([{ id: 2 }]);
  });

  test("stale rows are real rows — 陈旧数据仍应展示", () => {
    expect(realRows({ dataStatus: "stale", rows: [{ id: 3 }] })).toEqual([{ id: 3 }]);
  });

  test("blocks missing and simulated rows from charts", () => {
    expect(realRows({ dataStatus: "missing", rows: [{ id: 1 }] })).toEqual([]);
    expect(realRows({ dataStatus: "simulated", rows: [{ id: 1 }] })).toEqual([]);
  });

  test("uses backend missing reason when provided", () => {
    expect(missingReason({ missingReason: "缺少真实季报" }, "fallback")).toBe("缺少真实季报");
    expect(missingReason(null, "fallback")).toBe("fallback");
  });
});

describe("deriveStatus — 数据覆盖度状态推导", () => {
  test("dataStatus=available + hasData=true → available", () => {
    expect(deriveStatus({ dataStatus: "available", hasData: true })).toBe("available");
  });

  test("dataStatus=available + hasData=false → available（不被误判为缺失）", () => {
    expect(deriveStatus({ dataStatus: "available", hasData: false })).toBe("available");
  });

  test("dataStatus=partial → partial", () => {
    expect(deriveStatus({ dataStatus: "partial", hasData: true })).toBe("partial");
    expect(deriveStatus({ dataStatus: "partial", hasData: false })).toBe("partial");
  });

  test("dataStatus=stale + hasData=true → stale", () => {
    expect(deriveStatus({ dataStatus: "stale", hasData: true })).toBe("stale");
    expect(deriveStatus({ dataStatus: "stale", hasData: false })).toBe("stale");
  });

  test("dataStatus=missing → missing", () => {
    expect(deriveStatus({ dataStatus: "missing", hasData: false })).toBe("missing");
  });

  test("dataStatus=simulated → missing（兼容旧契约）", () => {
    expect(deriveStatus({ dataStatus: "simulated", hasData: true })).toBe("missing");
  });

  test("isError 优先于 dataStatus", () => {
    expect(deriveStatus({ isError: true, dataStatus: "available" })).toBe("error");
    expect(deriveStatus({ isError: true, dataStatus: "partial" })).toBe("error");
  });

  test("isLoading 且无数据 → pending", () => {
    expect(deriveStatus({ isLoading: true, hasData: false })).toBe("pending");
  });

  test("isLoading 但已有数据 → 走 dataStatus 判定（不强制 pending）", () => {
    expect(deriveStatus({ isLoading: true, hasData: true, dataStatus: "available" })).toBe(
      "available",
    );
  });

  test("无 dataStatus 但 hasData=true → available", () => {
    expect(deriveStatus({ hasData: true })).toBe("available");
  });

  test("无 dataStatus 且无数据 → missing", () => {
    expect(deriveStatus({})).toBe("missing");
    expect(deriveStatus({ hasData: false })).toBe("missing");
  });
});

describe("summarizeDetailCoverage — 覆盖度统计", () => {
  const e = (key: string, status: CoverageEntry["status"]): CoverageEntry => ({
    key: key as CoverageEntry["key"],
    label: key,
    endpoint: `trpc.fund.${key}`,
    status,
  });

  test("统计 available 数量", () => {
    const summary = summarizeDetailCoverage({
      a: e("a", "available"),
      b: e("b", "available"),
      c: e("c", "missing"),
    });
    expect(summary.total).toBe(3);
    expect(summary.available).toBe(2);
    expect(summary.missing).toBe(1);
    expect(summary.partial).toBe(0);
    expect(summary.pending).toBe(0);
    expect(summary.error).toBe(0);
  });

  test("统计各状态数量（含 stale）", () => {
    const summary = summarizeDetailCoverage({
      a: e("a", "available"),
      b: e("b", "partial"),
      c: e("c", "pending"),
      d: e("d", "missing"),
      e: e("e", "stale"),
      f: e("f", "error"),
    });
    expect(summary.total).toBe(6);
    expect(summary.available).toBe(1);
    expect(summary.partial).toBe(1);
    expect(summary.stale).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.missing).toBe(1);
    expect(summary.error).toBe(1);
  });

  test("空 entries 返回 0", () => {
    const summary = summarizeDetailCoverage({});
    expect(summary.total).toBe(0);
    expect(summary.available).toBe(0);
    expect(summary.items).toEqual([]);
  });

  test("未定义的 key 不会进入统计", () => {
    const summary = summarizeDetailCoverage({
      a: e("a", "available"),
    });
    expect(summary.total).toBe(1);
    expect(summary.items).toHaveLength(1);
  });
});
