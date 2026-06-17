type FieldSourceTipProps = {
  source?: string | null;
  asOf?: string | null;
  missingReason?: string | null;
};

export function FieldSourceTip({ source, asOf, missingReason }: FieldSourceTipProps) {
  const details = [
    source ? `source: ${source}` : null,
    asOf ? `as of: ${asOf}` : null,
    missingReason ? `missing: ${missingReason}` : null,
  ].filter(Boolean);

  if (details.length === 0) {
    return null;
  }

  return (
    <span
      className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/10 text-[10px] text-white/45"
      title={details.join("\n")}
    >
      i
    </span>
  );
}
