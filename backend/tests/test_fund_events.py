import sys
from types import SimpleNamespace

from app.data.fund_events import EastmoneyFundAnnouncementProvider, StaticFundEventProvider, collect_fund_events


class FailingProvider:
    name = "failing_events"
    enabled = True
    capabilities = ["fund_news"]
    last_error = None
    cooldown_until = None

    def fetch(self, fund_code):
        raise RuntimeError("provider unavailable")


def test_collect_fund_events_normalizes_static_provider_events():
    provider = StaticFundEventProvider(
        events=[
            {
                "fund_code": "000001",
                "title": "Quarterly report released",
                "url": "https://example.test/report",
                "published_at": "2026-06-18",
                "event_type": "announcement",
                "summary": "Manager commentary and holdings update.",
            },
            {
                "fund_code": "999999",
                "title": "Other fund",
                "published_at": "2026-06-18",
            },
        ]
    )

    payload = collect_fund_events("000001", [provider])

    assert payload["status"] == "available"
    assert len(payload["events"]) == 1
    event = payload["events"][0]
    assert event["title"] == "Quarterly report released"
    assert event["fund_code"] == "000001"
    assert event["event_type"] == "announcement"
    assert event["data_quality"]["status"] == "available"
    assert event["field_sources"]["title"]["source"] == "static_fund_events"
    assert payload["provider_health"][0]["status"] == "available"


def test_collect_fund_events_downgrades_provider_failure():
    payload = collect_fund_events("000001", [FailingProvider()])

    assert payload["status"] == "partial"
    assert payload["events"] == []
    assert payload["data_quality"]["missing_reason"] == "provider failure"
    assert payload["provider_health"][0]["status"] == "failed"
    assert payload["provider_health"][0]["last_error"] == "provider unavailable"


def test_collect_fund_events_marks_disabled_provider():
    provider = StaticFundEventProvider(enabled=False)

    payload = collect_fund_events("000001", [provider])

    assert payload["status"] == "missing"
    assert payload["provider_health"][0]["status"] == "disabled"
    assert payload["data_quality"]["missing_reason"] == "no events returned"


def test_eastmoney_fund_announcement_provider_normalizes_akshare_rows(monkeypatch):
    class FakeNotices:
        empty = False

        def to_dict(self, mode):
            assert mode == "records"
            return [
                {
                    "公告标题": "测试基金2026年第1季度报告",
                    "公告日期": "2026-04-20",
                    "报告ID": "AN202604200001",
                }
            ]

    fake_akshare = SimpleNamespace(fund_announcement_report_em=lambda symbol: FakeNotices())
    monkeypatch.setitem(sys.modules, "akshare", fake_akshare)
    provider = EastmoneyFundAnnouncementProvider(enabled=True)

    payload = collect_fund_events("000001", [provider])

    assert payload["status"] == "available"
    assert payload["events"][0]["source"] == "eastmoney:fund_announcement_report"
    assert payload["events"][0]["event_type"] == "announcement"
    assert payload["events"][0]["field_sources"]["title"]["source"] == "eastmoney:fund_announcement_report"
