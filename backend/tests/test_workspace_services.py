from app.services.client_360 import build_client_360
from app.services.feature_flags import workspace_feature_snapshot
from app.services.nba_engine import build_task_drafts, generate_nba_suggestions


def test_client_360_strips_direct_contact_fields():
    profile = build_client_360(
        {
            "client": {
                "client_ref": "c001",
                "name": "Client A",
                "phone": "13800000000",
                "email": "a@example.com",
                "risk_level": "conservative",
            },
            "holdings": [{"asset_class": "equity", "weight": 0.5, "contact": "hidden"}],
        }
    )

    assert profile["client_ref"] == "c001"
    assert profile["contact_policy"]["direct_contact_storage"] == "disabled"
    assert sorted(profile["contact_policy"]["removed_fields"]) == ["contact", "email", "phone"]
    assert "13800000000" not in str(profile)
    assert "a@example.com" not in str(profile)


def test_nba_suggestions_are_manual_only_and_never_auto_send():
    profile = build_client_360(
        {
            "client": {"client_ref": "c002", "risk_level": "conservative"},
            "holdings": [{"asset_class": "equity", "weight": 0.6}],
        }
    )

    result = generate_nba_suggestions(profile, {"dca_status": "partial"})

    assert result["policy"]["manual_only"] is True
    assert result["policy"]["auto_send"] is False
    assert result["suggestions"]
    assert all(item["manual_only"] is True for item in result["suggestions"])
    assert all(item["auto_send"] is False for item in result["suggestions"])


def test_task_drafts_require_manual_approval():
    suggestions = [
        {
            "id": "complete_risk_profile",
            "title": "Complete client risk profile",
            "priority": "high",
            "rationale": "Missing risk level",
        }
    ]

    result = build_task_drafts(suggestions)

    assert result["policy"]["auto_send"] is False
    assert result["tasks"][0]["status"] == "draft"
    assert result["tasks"][0]["requires_manual_approval"] is True
    assert result["tasks"][0]["auto_send"] is False


def test_workspace_feature_flags_disable_contact_storage_and_auto_outreach():
    flags = workspace_feature_snapshot()

    assert flags["client_360"] is True
    assert flags["nba_suggestions"] is True
    assert flags["direct_contact_storage"] is False
    assert flags["auto_outreach"] is False
