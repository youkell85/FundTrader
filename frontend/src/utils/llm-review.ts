/**
 * LLM Review text parsing utilities
 * Extracted from fund-router.ts and FundDetail.tsx to avoid duplication
 */

export function parseReviewText(text: string): any | null {
  const trimmed = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const jsonText = trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
  try {
    return JSON.parse(jsonText);
  } catch {
    const review: Record<string, any> = {};
    const stringKeys = [
      "performance_review",
      "risk_review",
      "manager_review",
      "holdings_review",
      "investment_advice",
    ];
    stringKeys.forEach((key) => {
      const match = jsonText.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
      if (!match) return;
      try {
        review[key] = JSON.parse(`"${match[1]}"`);
      } catch {
        review[key] = match[1];
      }
    });
    ["risk_warnings", "strengths"].forEach((key) => {
      const match = jsonText.match(new RegExp(`"${key}"\\s*:\\s*(\\[[\\s\\S]*?\\])`));
      if (!match) return;
      try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed)) review[key] = parsed;
      } catch {
        // LLM 偶尔会在数组处截断，此时展示前面已识别的文本字段
      }
    });
    return Object.keys(review).length
      ? { ...review, parseWarning: "AI 返回内容不完整，已展示可识别部分。可点击刷新重新生成。" }
      : null;
  }
}

export function normalizeReview(review: any): any {
  if (typeof review === "string") {
    return parseReviewText(review) || { raw: review };
  }
  if (review?.raw && typeof review.raw === "string") {
    return parseReviewText(review.raw) || review;
  }
  return review || {};
}

export function isJsonLikeText(value: unknown): boolean {
  const text = String(value || "").trim();
  return text.startsWith("{") || text.startsWith("```json") || text.includes('"performance_review"');
}
