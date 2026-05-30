interface MetricCardProps {
  label: string;
  value: string | number;
  color?: string;
  suffix?: string;
  className?: string;
}

export default function MetricCard({ label, value, color = '#5AA9FF', suffix, className = '' }: MetricCardProps) {
  return (
    <div className={`rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-3 ${className}`}>
      <div className="text-white/55 text-xs">{label}</div>
      <div className="data-number mt-1 text-lg font-medium" style={{ color }}>
        {value}{suffix || ''}
      </div>
    </div>
  );
}
