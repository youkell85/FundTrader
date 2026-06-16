from unittest.mock import patch

from app.data.providers.tickflow_provider import TickflowClientFactory


class _FakeTickFlow:
    @staticmethod
    def free():
        print("\U0001f193 TickFlow free tier")
        return {"mode": "free"}


class _PaidFailsTickFlow(_FakeTickFlow):
    def __init__(self, api_key: str, base_url: str | None = None):
        raise RuntimeError("bad key")


class _PaidTickFlow:
    def __init__(self, api_key: str, base_url: str | None = None):
        self.api_key = api_key
        self.base_url = base_url


def test_tickflow_free_client_suppresses_sdk_notice():
    assert TickflowClientFactory._build_free_client(_FakeTickFlow) == {"mode": "free"}


def test_tickflow_auto_falls_back_to_free_when_paid_init_fails():
    with patch.dict("sys.modules", {"tickflow": type("M", (), {"TickFlow": _PaidFailsTickFlow})}):
        client = TickflowClientFactory.build_client(mode="auto", api_key="secret")

    assert client == {"mode": "free"}


def test_tickflow_paid_client_receives_base_url():
    with patch.dict("sys.modules", {"tickflow": type("M", (), {"TickFlow": _PaidTickFlow})}):
        client = TickflowClientFactory.build_client(
            mode="paid",
            api_key="secret",
            base_url="https://api.tickflow.org",
        )

    assert client.api_key == "secret"
    assert client.base_url == "https://api.tickflow.org"
