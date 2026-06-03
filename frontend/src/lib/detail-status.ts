export type DetailDataStatus = "available" | "partial" | "missing" | "simulated";

export type DetailRowsPayload<T> = {
  rows?: T[];
  dataStatus?: DetailDataStatus;
  missingReason?: string | null;
  source?: string | null;
  asOf?: string | null;
};

export function isRealDetailStatus(status?: DetailDataStatus | string | null) {
  return status === "available" || status === "partial" || status === undefined;
}

export function realRows<T>(payload: DetailRowsPayload<T> | null | undefined): T[] {
  if (!payload || !isRealDetailStatus(payload.dataStatus)) return [];
  return Array.isArray(payload.rows) ? payload.rows : [];
}

export function missingReason(payload: { missingReason?: string | null } | null | undefined, fallback: string) {
  return payload?.missingReason || fallback;
}
