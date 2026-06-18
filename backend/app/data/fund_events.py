"""Fund news and announcement aggregation with provider health metadata."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Iterable, Protocol


class FundEventProvider(Protocol):
    name: str
    enabled: bool
    capabilities: list[str]
    last_error: str | None
    cooldown_until: str | None

    def fetch(self, fund_code: str) -> list[dict[str, Any]]:
        ...


@dataclass
class StaticFundEventProvider:
    """Deterministic local provider used by tests and offline report snapshots."""

    events: list[dict[str, Any]] = field(default_factory=list)
    name: str = "static_fund_events"
    enabled: bool = True
    capabilities: list[str] = field(default_factory=lambda: ["fund_news", "fund_announcement"])
    last_error: str | None = None
    cooldown_until: str | None = None

    def fetch(self, fund_code: str) -> list[dict[str, Any]]:
        return [
            event
            for event in self.events
            if not event.get("fund_code") or str(event.get("fund_code")) == str(fund_code)
        ]


@dataclass
class EastmoneyFundAnnouncementProvider:
    """Live Eastmoney fund announcement provider backed by AkShare."""

    enabled: bool = field(default_factory=lambda: os.getenv("FUND_EVENTS_EASTMONEY_ENABLED", "false").lower() in {"1", "true", "yes", "on"})
    limit: int = 10
    name: str = "eastmoney_fund_announcement"
    capabilities: list[str] = field(default_factory=lambda: ["fund_announcement"])
    last_error: str | None = None
    cooldown_until: str | None = None

    def fetch(self, fund_code: str) -> list[dict[str, Any]]:
        if not self.enabled:
            return []
        try:
            import akshare as ak
        except Exception as exc:
            raise RuntimeError(f"akshare unavailable: {exc}") from exc

        notices = ak.fund_announcement_report_em(symbol=str(fund_code))
        if notices is None or getattr(notices, "empty", True):
            return []

        rows: list[dict[str, Any]] = []
        for raw in notices.to_dict("records"):
            title = _first(raw, "公告标题", "title", "TITLE")
            published_at = _first(raw, "公告日期", "date", "publishDate", "PUBLISHDATE")
            report_id = _first(raw, "报告ID", "report_id", "art_code", "ART_CODE")
            url = _first(raw, "公告链接", "url", "link")
            if not url and report_id:
                url = f"https://np-cnotice-fund.eastmoney.com/api/content/ann?art_code={report_id}&client_source=web"
            if not title:
                continue
            rows.append({
                "title": title,
                "url": url,
                "source": "eastmoney:fund_announcement_report",
                "published_at": published_at,
                "fund_code": str(fund_code),
                "event_type": "announcement",
                "summary": title,
            })
            if len(rows) >= self.limit:
                break
        return rows


def _first(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip().lower() not in {"", "nan", "nat", "none"}:
            return str(value).strip()
    return None


def default_fund_event_providers() -> list[FundEventProvider]:
    return [EastmoneyFundAnnouncementProvider()]


def _quality(status: str, source: str, reason: str | None = None) -> dict[str, Any]:
    return {
        "status": status,
        "source": source,
        "missing_reason": reason,
    }


def _field_sources(source: str, status: str) -> dict[str, dict[str, Any]]:
    return {
        field: {"source": source, "status": status}
        for field in ("title", "url", "published_at", "fund_code", "event_type", "summary")
    }


def _normalize_event(raw: dict[str, Any], fund_code: str, source: str) -> dict[str, Any]:
    title = str(raw.get("title") or raw.get("name") or "Untitled fund event")
    published_at = raw.get("published_at") or raw.get("publishDate") or raw.get("date")
    status = "available" if title and published_at else "partial"
    reason = None if status == "available" else "missing title or published_at"
    event_source = raw.get("source") or source
    return {
        "title": title,
        "url": raw.get("url") or raw.get("link"),
        "source": event_source,
        "published_at": published_at,
        "fund_code": str(raw.get("fund_code") or raw.get("code") or fund_code),
        "event_type": raw.get("event_type") or raw.get("type") or "news",
        "summary": raw.get("summary") or raw.get("snippet") or "",
        "data_quality": raw.get("data_quality") or _quality(status, event_source, reason),
        "field_sources": raw.get("field_sources") or _field_sources(event_source, status),
    }


def _provider_health(provider: FundEventProvider, status: str) -> dict[str, Any]:
    return {
        "name": provider.name,
        "enabled": bool(provider.enabled),
        "capabilities": list(provider.capabilities),
        "status": status,
        "last_error": provider.last_error,
        "cooldown_until": provider.cooldown_until,
    }


def collect_fund_events(
    fund_code: str,
    providers: Iterable[FundEventProvider] | None = None,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Collect and normalize fund news/announcement events."""
    active_providers = list(default_fund_event_providers() if providers is None else providers)
    events: list[dict[str, Any]] = []
    health: list[dict[str, Any]] = []
    warnings: list[str] = []
    clock = now or datetime.utcnow()

    for provider in active_providers:
        if not provider.enabled:
            health.append(_provider_health(provider, "disabled"))
            continue
        try:
            fetched = provider.fetch(fund_code)
        except Exception as exc:  # pragma: no cover
            provider.last_error = str(exc)
            provider.cooldown_until = (clock + timedelta(minutes=5)).replace(microsecond=0).isoformat() + "Z"
            health.append(_provider_health(provider, "failed"))
            warnings.append(f"{provider.name} failed: {exc}")
            continue
        for item in fetched:
            events.append(_normalize_event(item, fund_code, provider.name))
        health.append(_provider_health(provider, "available" if fetched else "empty"))

    events.sort(key=lambda item: (str(item.get("published_at") or ""), item["title"]), reverse=True)
    if not active_providers:
        status = "missing"
        reason = "no fund event providers configured"
    elif events:
        status = "available"
        reason = None
    elif any(item["status"] == "failed" for item in health):
        status = "partial"
        reason = "provider failure"
    else:
        status = "missing"
        reason = "no events returned"

    return {
        "status": status,
        "fund_code": str(fund_code),
        "events": events,
        "provider_health": health,
        "data_quality": _quality(status, "fund_events", reason),
        "warnings": warnings,
    }
