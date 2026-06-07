import { describe, expect, test } from "vitest";
import {
  num,
  pct,
  numFmt,
  feePct,
  returnPct,
  drawdownPct,
  sharpeFmt,
  scaleYi,
  isMissing,
} from "@/lib/fund-data";

describe("num", () => {
  test("parses number", () => {
    expect(num(61.86)).toBe(61.86);
  });
  test("parses string number", () => {
    expect(num("61.86")).toBe(61.86);
  });
  test("strips % before parsing", () => {
    expect(num("61.86%")).toBe(61.86);
  });
  test("null returns null", () => {
    expect(num(null)).toBeNull();
  });
  test("undefined returns null", () => {
    expect(num(undefined)).toBeNull();
  });
  test("empty string returns null", () => {
    expect(num("")).toBeNull();
  });
  test("'—' returns null", () => {
    expect(num("—")).toBeNull();
  });
  test("NaN string returns null", () => {
    expect(num("abc")).toBeNull();
  });
});

describe("pct", () => {
  test("formats 61.86 -> 61.86%", () => {
    expect(pct(61.86)).toBe("61.86%");
  });
  test("formats -3.2 -> -3.20%", () => {
    expect(pct(-3.2)).toBe("-3.20%");
  });
  test("null -> —", () => {
    expect(pct(null)).toBe("—");
  });
});

describe("returnPct", () => {
  test("61.86 -> 61.86%", () => {
    expect(returnPct(61.86)).toBe("61.86%");
  });
  test("-3.2 -> -3.20%", () => {
    expect(returnPct(-3.2)).toBe("-3.20%");
  });
  test("null -> —", () => {
    expect(returnPct(null)).toBe("—");
  });
  test("string '10.5' -> 10.50%", () => {
    expect(returnPct("10.5")).toBe("10.50%");
  });
});

describe("drawdownPct", () => {
  test("decimal -0.6359 -> -63.59%", () => {
    expect(drawdownPct(-0.6359)).toBe("-63.59%");
  });
  test("percent -63.59 -> -63.59%", () => {
    expect(drawdownPct(-63.59)).toBe("-63.59%");
  });
  test("null -> —", () => {
    expect(drawdownPct(null)).toBe("—");
  });
  test("positive decimal 0.05 -> 5.00%", () => {
    expect(drawdownPct(0.05)).toBe("5.00%");
  });
  test("positive percent 5 -> 5.00%", () => {
    expect(drawdownPct(5)).toBe("5.00%");
  });
});

describe("feePct", () => {
  test("decimal 0.015 -> 1.50%", () => {
    expect(feePct(0.015)).toBe("1.50%");
  });
  test("percent 1.5 -> 1.50%", () => {
    expect(feePct(1.5)).toBe("1.50%");
  });
  test("null -> —", () => {
    expect(feePct(null)).toBe("—");
  });
  test("string decimal '0.012' -> 1.20%", () => {
    expect(feePct("0.012")).toBe("1.20%");
  });
});

describe("sharpeFmt", () => {
  test("formats number without %", () => {
    expect(sharpeFmt(-0.71)).toBe("-0.71");
  });
  test("formats 1.23", () => {
    expect(sharpeFmt(1.23)).toBe("1.23");
  });
  test("null -> —", () => {
    expect(sharpeFmt(null)).toBe("—");
  });
  test("does not contain %", () => {
    const result = sharpeFmt(1.5);
    expect(result).not.toContain("%");
  });
});

describe("scaleYi", () => {
  test("50.5 -> 50.50亿", () => {
    expect(scaleYi(50.5)).toBe("50.50亿");
  });
  test("null -> —", () => {
    expect(scaleYi(null)).toBe("—");
  });
});

describe("isMissing", () => {
  test("null is missing", () => {
    expect(isMissing(null)).toBe(true);
  });
  test("'—' is missing", () => {
    expect(isMissing("—")).toBe(true);
  });
  test("number is not missing", () => {
    expect(isMissing(5)).toBe(false);
  });
});
