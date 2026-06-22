"""Feature flags for institution workspace capabilities."""
from __future__ import annotations


WORKSPACE_FLAGS = {
    "client_360": True,
    "nba_suggestions": True,
    "task_drafts": True,
    "auto_outreach": False,
    "direct_contact_storage": False,
    "org_rbac_import": False,
}


def is_enabled(flag: str) -> bool:
    return bool(WORKSPACE_FLAGS.get(flag, False))


def workspace_feature_snapshot() -> dict[str, bool]:
    return dict(WORKSPACE_FLAGS)
