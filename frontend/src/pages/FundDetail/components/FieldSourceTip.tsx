type FieldSourceTipProps = {
  source?: string | null;
  asOf?: string | null;
  missingReason?: string | null;
  status?: string | null;
};

export function FieldSourceTip({ source, asOf, missingReason, status }: FieldSourceTipProps) {
  const isMissing = status === "missing" || status === "unknown";
  const details = [
    source ? `source: ${source}` : null,
    asOf ? `as of: ${asOf}` : null,
    missingReason ? `reason: ${missingReason}` : null,
  ].filter(Boolean);

  if (details.length === 0 && !isMissing) {
    return null;
  }

  return (
    <span
      className={`ml-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] leading-none ${
        isMissing
          ? "border-[#F5384B]/30 bg-[#F5384B]/5 text-[#F5384B]"
          : "border-white/10 text-white/45"
      }`}
      title={details.join("\n")}
    >
      {isMissing ? "!" : "i"}
    </span>
  );
}
