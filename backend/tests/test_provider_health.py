from unittest.mock import patch

from app.data.providers.fusion import (
    DataFusion,
    PROVIDER_COOLDOWN_SECONDS,
    PROVIDER_FAILURE_THRESHOLD,
)


def test_provider_status_contract_exposes_circuit_fields():
    fusion = DataFusion()
    first = fusion.get_provider_health_snapshot()["providers"][0]

    assert "capabilities" in first
    assert "status" in first
    assert "lastSuccessAt" in first
    assert "lastError" in first
    assert "cooldownUntil" in first
    assert "failureCount" in first
    assert "circuitOpen" in first


def test_provider_failures_open_circuit_and_cooldown():
    fusion = DataFusion()
    provider = fusion.providers[0]

    with patch.object(provider, "is_available", return_value=True):
        for _ in range(PROVIDER_FAILURE_THRESHOLD):
            fusion._mark_provider_status(provider, success=False, error="quota exceeded", source_hint="test")

        status = {p["name"]: p for p in fusion.get_providers_status()}[provider.name]

    assert status["status"] == "cooldown"
    assert status["available"] is False
    assert status["lastError"] == "quota exceeded"
    assert status["failureCount"] == PROVIDER_FAILURE_THRESHOLD
    assert status["circuitOpen"] is True
    assert status["cooldownUntil"]
    assert PROVIDER_COOLDOWN_SECONDS == 300


def test_provider_success_resets_failure_count_and_cooldown():
    fusion = DataFusion()
    provider = fusion.providers[0]

    with patch.object(provider, "is_available", return_value=True):
        for _ in range(PROVIDER_FAILURE_THRESHOLD):
            fusion._mark_provider_status(provider, success=False, error="timeout")

        fusion._mark_provider_status(provider, success=True, used=True, source_hint="recovered")
        status = {p["name"]: p for p in fusion.get_providers_status()}[provider.name]

    assert status["status"] == "available"
    assert status["available"] is True
    assert status["failureCount"] == 0
    assert status["circuitOpen"] is False
    assert status["cooldownUntil"] is None
    assert status["lastSuccessAt"]
    assert status["lastError"] is None
