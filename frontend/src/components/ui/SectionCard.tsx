import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface SectionCardProps {
  title: string;
  icon?: LucideIcon;
  iconColor?: string;
  children: ReactNode;
  className?: string;
  accent?: boolean;
  accentColor?: string;
  interactive?: boolean;
}

export default function SectionCard({
  title,
  icon: Icon,
  iconColor = '#3B6CFF',
  children,
  className = '',
  accent = false,
  accentColor = '#FFB800',
  interactive = false,
}: SectionCardProps) {
  if (interactive) {
    return (
      <div
        className={`liquid-glass p-4 md:p-5 ${className}`}
        style={accent ? { borderLeft: `3px solid ${accentColor}` } : undefined}
      >
        <h3 className="text-sm text-white/70 mb-3 flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4" style={{ color: iconColor }} />}
          {title}
        </h3>
        {children}
      </div>
    );
  }

  return (
    <div className={className} style={accent ? { borderLeft: `2px solid ${accentColor}` } : undefined}>
      <h3 className="text-xs text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
        {Icon && <Icon className="w-3.5 h-3.5" style={{ color: iconColor }} />}
        {title}
      </h3>
      {children}
    </div>
  );
}
