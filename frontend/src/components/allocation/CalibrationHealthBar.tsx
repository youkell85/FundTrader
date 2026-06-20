import { useState, useEffect } from 'react';
import { Shield, AlertTriangle, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { CALIBRATION_SECTION_LABELS, CALIBRATION_STATUS_LABELS, HEALTH_COLORS } from '@/types/allocation';
import type { CalibrationAudit } from '@/types/allocation';
import { getPipelineHealth } from '@/lib/api';

/** Compact calibration health bar for allocation main pages.
 *  Shows at-a-glance: health status, coverage %, drift warnings count.
 *  Expandable to show per-section detail. */
export default function CalibrationHealthBar() {
  const [loading, setLoading] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationAudit | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getPipelineHealth()
      .then((resp) => { if (active) setCalibration(resp.calibration ?? null); })
      .catch((e: any) => { if (active && e?.name !== 'AbortError') setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading && !calibration) return null;
  if (error && !calibration) return null;
  if (!calibration) return null;

  const color = HEALTH_COLORS[calibration.health] || '#666';
  const healthLabel =
    calibration.health === 'healthy' ? '健康' :
    calibration.health === 'degraded' ? '降级' :
    calibration.health === 'critical' ? '异常' : '未知';

  const realCount = calibration.sections.filter(s => s.status === 'real').length;
  const totalCount = calibration.sections.length;
  const coveragePct = totalCount > 0 ? Math.round((realCount / totalCount) * 100) : 0;

  // Collect drift warnings with asset detail
  const driftWarnings = calibration.sections
    .flatMap(s => s.warnings.map(w => ({ section: s.key, warning: w })));

  const HealthIcon = calibration.health === 'healthy' ? Shield :
                     calibration.health === 'degraded' ? AlertTriangle : XCircle;

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      {/* Header row - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <HealthIcon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
          <span className="text-white/60">校准状态</span>
          <span
            className="px-1.5 py-0.5 rounded text-[11px] font-medium"
            style={{ background: color + '20', color }}
          >
            {healthLabel}
          </span>
          <span className="text-white/35">
            实时 {realCount}/{totalCount}
            <span className="mx-1">·</span>
            覆盖 {coveragePct}%
          </span>
          {calibration.warning_count > 0 && (
            <span className="text-[#FAC858]">
              {calibration.warning_count} 警告
            </span>
          )}
          {calibration.missing_count > 0 && (
            <span className="text-[#EE6666]">
              {calibration.missing_count} 缺失
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-white/30" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-white/30" />
        )}
      </button>

      {/* Expandable detail */}
      {expanded && (
        <div className="border-t border-white/[0.04] px-4 py-3 space-y-2">
          {/* Section status grid */}
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-1.5">
            {calibration.sections.map((s) => {
              const sColor = s.status === 'real' ? '#16C784' :
                             s.status === 'partial' ? '#FAC858' :
                             s.status === 'assumption' ? '#FFB800' :
                             s.status === 'missing' ? '#EE6666' : '#666';
              return (
                <div
                  key={s.key}
                  className="rounded px-2 py-1.5 text-center"
                  style={{ background: sColor + '10', border: `1px solid ${sColor}20` }}
                >
                  <div className="text-[10px] text-white/50 truncate">
                    {CALIBRATION_SECTION_LABELS[s.key] || s.key}
                  </div>
                  <div className="text-[11px] font-medium mt-0.5" style={{ color: sColor }}>
                    {CALIBRATION_STATUS_LABELS[s.status] || s.status}
                  </div>
                  {s.coverage != null && (
                    <div className="text-[9px] text-white/30 mt-0.5">
                      {(s.coverage * 100).toFixed(0)}%
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Drift warnings */}
          {driftWarnings.length > 0 && (
            <div className="space-y-1 mt-2">
              <div className="text-[10px] text-white/40 uppercase tracking-wider">漂移警告</div>
              {driftWarnings.slice(0, 8).map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px] text-[#FAC858]/80">
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                  <span>
                    <span className="text-white/50">{CALIBRATION_SECTION_LABELS[w.section] || w.section}</span>
                    : {w.warning}
                  </span>
                </div>
              ))}
              {driftWarnings.length > 8 && (
                <div className="text-[10px] text-white/30">... 及其他 {driftWarnings.length - 8} 条</div>
              )}
            </div>
          )}

          {/* Policy info */}
          {calibration.policy && (
            <div className="text-[10px] text-white/25 mt-1">
              策略: {calibration.policy.policy_source}
              {calibration.policy.policy_version ? ` v${calibration.policy.policy_version}` : ''}
              {' '}| 跳跃概率 {calibration.policy.jump_probability_min?.toFixed(2)}-{calibration.policy.jump_probability_max?.toFixed(2)}
              {' '}| 覆盖阈值 {(calibration.policy.coverage_threshold * 100).toFixed(0)}%
            </div>
          )}
        </div>
      )}
    </div>
  );
}
