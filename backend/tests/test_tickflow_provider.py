from unittest.mock import patch

from app.data.providers.tickflow_provider import TickflowClientFactory


class _FakeTickFlow:
    @staticmethod
    def free():
        print("\U0001f193 TickFlow free tier")
        return {"mode": "free"}


class _PaidFailsTickFlow(_FakeTickFlow):
    def __init__(self, api_key: str):
        raise RuntimeError("bad key")


def test_tickflow_free_client_suppresses_sdk_notice():
    assert TickflowClientFactory._build_free_client(_FakeTickFlow) == {"mode": "free"}


def test_tickflow_auto_falls_back_to_free_when_paid_init_fails():
    with patch.dict("sys.modules", {"tickflow": type("M", (), {"TickFlow": _PaidFailsTickFlow})}):
        client = TickflowClientFactory.build_client(mode="auto", api_key="secret")

    assert client == {"mode": "free"}
