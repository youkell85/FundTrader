interface MetricCardProps {
  label: string;
  value: string | number;
  color?: string;
  suffix?: string;
  className?: string;
}

const COLOR_MAP: Record<string, string> = {
  '#5AA9FF': 'text-info',
  '#3B6CFF': 'text-primary',
  '#16C784': 'text-success',
  '#EE6666': 'text-danger',
  '#FAC858': 'text-warning',
  '#F59E0B': 'text-warning',
  '#FFB800': 'text-warning',
  '#91CC75': 'text-success',
  '#5470C6': 'text-info',
  '#9D7BFF': 'text-purple-400',
  '#73C0DE': 'text-info',
  '#FF6B35': 'text-orange-400',
};

export default function MetricCard({ label, value, color = '#5AA9FF', suffix, className = '' }: MetricCardProps) {
  const colorClass = COLOR_MAP[color] || 'text-info';
  return (
    <div className={`surface px-3 py-3 ${className}`}>
      <div className="text-white/55 text-xs">{label}</div>
      <div className={`data-number mt-1 text-lg font-medium ${colorClass}`}>
        {value}{suffix || ''}
      </div>
    </div>
  );
}
