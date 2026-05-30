import { useState, useEffect, useCallback, useRef } from "react";
import {
  getActiveAlerts,
  markAlertRead as apiMarkRead,
  clearAllAlerts as apiClearAll,
  checkPlanAlerts,
  type AlertItem,
  type AlertListResult,
} from "@/lib/api";

const POLL_INTERVAL = 60_000; // 60 seconds
const MAX_SEEN_IDS = 200;

/**
 * Request browser notification permission (call once on mount or user action).
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

/**
 * Show a browser notification (no-op if permission not granted).
 */
function showBrowserNotification(alert: AlertItem) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const icon = alert.severity === "critical" ? "/favicon.ico" : undefined;
  const n = new Notification(alert.title, {
    body: alert.message,
    icon,
    tag: alert.id, // dedup by alert id
  });
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

/**
 * Hook that polls for portfolio alerts and triggers browser notifications.
 *
 * Usage:
 *   const { alerts, unreadCount, markRead, clearAll, refresh } = useAlertNotifications({
 *     enabled: true,
 *     planIds: ["abc123"],          // optional: auto-check specific plans
 *     pollInterval: 60000,          // optional: override default 60s
 *     browserNotify: true,          // optional: enable browser push (default true)
 *   });
 */
export function useAlertNotifications(options?: {
  enabled?: boolean;
  planIds?: string[];
  pollInterval?: number;
  browserNotify?: boolean;
}) {
  const {
    enabled = true,
    planIds = [],
    pollInterval = POLL_INTERVAL,
    browserNotify = true,
  } = options || {};

  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [criticalCount, setCriticalCount] = useState(0);
  const seenIds = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAlerts = useCallback(async () => {
    if (!enabled) return;
    try {
      // Optionally trigger plan-specific checks
      if (planIds.length > 0) {
        for (const pid of planIds) {
          await checkPlanAlerts(pid).catch(() => {});
        }
      }

      const result: AlertListResult = await getActiveAlerts();
      setAlerts(result.alerts);
      setUnreadCount(result.count);
      setCriticalCount(result.unread_critical);

      // Fire browser notifications for newly arrived alerts
      if (browserNotify) {
        for (const a of result.alerts) {
          if (!seenIds.current.has(a.id) && (a.severity === "critical" || a.severity === "warning")) {
            showBrowserNotification(a);
          }
          seenIds.current.add(a.id);
        }
        if (seenIds.current.size > MAX_SEEN_IDS) {
          const entries = Array.from(seenIds.current);
          seenIds.current = new Set(entries.slice(entries.length - MAX_SEEN_IDS));
        }
      }
    } catch {
      // Silently ignore polling errors (network offline, etc.)
    }
  }, [enabled, planIds, browserNotify]);

  // Start / stop polling
  useEffect(() => {
    if (!enabled) return;
    fetchAlerts(); // initial fetch
    timerRef.current = setInterval(fetchAlerts, pollInterval);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [enabled, fetchAlerts, pollInterval]);

  const markRead = useCallback(async (alertId: string) => {
    await apiMarkRead(alertId);
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    setUnreadCount((c) => Math.max(0, c - 1));
  }, []);

  const clearAll = useCallback(async () => {
    await apiClearAll();
    setAlerts([]);
    setUnreadCount(0);
    setCriticalCount(0);
    seenIds.current.clear();
  }, []);

  return {
    alerts,
    unreadCount,
    criticalCount,
    markRead,
    clearAll,
    refresh: fetchAlerts,
  };
}
