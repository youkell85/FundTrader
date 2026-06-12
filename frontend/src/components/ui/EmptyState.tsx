import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export default function EmptyState({
  icon: Icon = Inbox,
  title = '暂无数据',
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <Icon className="w-10 h-10 text-white/15 mb-3" />
      <p className="text-sm text-white/40 mb-1">{title}</p>
      {description && (
        <p className="text-xs text-white/25 max-w-xs">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 rounded-lg bg-primary/15 text-primary text-xs font-medium hover:bg-primary/25 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
