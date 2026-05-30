/**
 * LLM Review text parsing utilities
 * Extracted from fund-router.ts and FundDetail.tsx to avoid duplication
 */

export interface FundReview {
  performance_review?: string;
  risk_review?: string;
  manager_review?: string;
  holdings_review?: string;
  investment_advice?: string;
  risk_warnings?: string[];
  strengths?: string[];
  parseWarning?: string;
  raw?: string;
}

const STRING_FIELDS = [
  "performance_review",
  "risk_review",
  "manager_review",
  "holdings_review",
  "investment_advice",
] as const;

const ARRAY_FIELDS = ["risk_warnings", "strengths"] as const;

function cleanMarkdownJson(text: string): string {
  const trimmed = String(text || "").trim();
  const withoutCodeBlock = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  return withoutCodeBlock.match(/\{[\s\S]*\}/)?.[0] || withoutCodeBlock;
}

function tryParseJson(text: string): FundReview | null {
  try {
    return JSON.parse(text) as FundReview;
  } catch {
    return null;
  }
}

function extractStringFields(
  text: string,
  fields: readonly string[]
): Partial<FundReview> {
  const result: Partial<FundReview> = {};
  fields.forEach((key) => {
    const match = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
    if (!match) return;
    try {
      (result as Record<string, string>)[key] = JSON.parse(`"${match[1]}"`);
    } catch {
      (result as Record<string, string>)[key] = match[1];
    }
  });
  return result;
}

function extractArrayFields(
  text: string,
  fields: readonly string[]
): Partial<FundReview> {
  const result: Partial<FundReview> = {};
  fields.forEach((key) => {
    const match = text.match(new RegExp(`"${key}"\\s*:\\s*(\\[[\\s\\S]*?\\])`));
    if (!match) return;
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) {
        (result as Record<string, string[]>)[key] = parsed;
      }
    } catch {
      // 静默失败，字段不会被添加
    }
  });
  return result;
}

export function parseReviewText(text: string): FundReview | null {
  const cleanedText = cleanMarkdownJson(text);

  const directParse = tryParseJson(cleanedText);
  if (directParse) {
    return directParse;
  }

  const stringFields = extractStringFields(cleanedText, STRING_FIELDS);
  const arrayFields = extractArrayFields(cleanedText, ARRAY_FIELDS);
  const partialReview: FundReview = { ...stringFields, ...arrayFields };

  if (Object.keys(partialReview).length > 0) {
    return {
      ...partialReview,
      parseWarning: "AI 返回数据不完整，仅展示识别到的部分。建议刷新重试。",
    };
  }

  return null;
}

export function normalizeReview(review: unknown): FundReview {
  if (typeof review === "string") {
    return parseReviewText(review) || { raw: review };
  }
  if (
    review &&
    typeof review === "object" &&
    "raw" in review &&
    typeof (review as Record<string, unknown>).raw === "string"
  ) {
    return (
      parseReviewText((review as Record<string, string>).raw) ||
      (review as FundReview)
    );
  }
  return (review as FundReview) || {};
}

export function isJsonLikeText(value: unknown): boolean {
  const text = String(value || "").trim();
  return (
    text.startsWith("{") ||
    text.startsWith("```json") ||
    text.includes('"performance_review"')
  );
}
