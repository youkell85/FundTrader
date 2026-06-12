import React from 'react';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  rows?: number;
}

export function Skeleton({ rows, className = '', style, children, ...rest }: SkeletonProps) {
  if (rows != null) {
    return (
      <div className={`space-y-2 ${className}`} style={style} {...rest}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="h-8 rounded-lg bg-white/[0.04] animate-pulse"
            style={{ width: i === rows - 1 ? '60%' : '100%' }}
          />
        ))}
      </div>
    );
  }
  return (
    <div className={className} style={style} {...rest}>
      {children}
    </div>
  );
}

/** Skeleton for a single metric card */
export function MetricSkeleton() {
  return (
    <div className="surface px-3 py-3 space-y-2">
      <div className="h-3 w-16 rounded bg-white/[0.04] animate-pulse" />
      <div className="h-5 w-20 rounded bg-white/[0.06] animate-pulse" />
    </div>
  );
}
