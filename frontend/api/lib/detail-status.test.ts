import { describe, expect, test } from "vitest";
import { missingReason, realRows } from "@/lib/detail-status";

describe("detail status helpers", () => {
  test("allows available and partial rows", () => {
    expect(realRows({ dataStatus: "available", rows: [{ id: 1 }] })).toEqual([{ id: 1 }]);
    expect(realRows({ dataStatus: "partial", rows: [{ id: 2 }] })).toEqual([{ id: 2 }]);
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
