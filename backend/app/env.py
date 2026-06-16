"""Environment loading helpers for FundTrader backend code."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

_LOADED = False
_LOADED_PATH: Optional[Path] = None


def get_backend_env_path() -> Path:
    return Path(__file__).resolve().parent.parent / ".env"


def get_project_env_path() -> Path:
    return Path(__file__).resolve().parent.parent.parent / ".env"


def load_backend_env(*, override: bool = False) -> Optional[Path]:
    """Load backend/.env before any token or LLM settings are read."""
    global _LOADED, _LOADED_PATH
    if _LOADED and not override:
        return _LOADED_PATH

    try:
        from dotenv import load_dotenv
    except ImportError:
        _LOADED = True
        return None

    for env_path in (get_backend_env_path(), get_project_env_path()):
        if env_path.exists():
            load_dotenv(env_path, override=override)
            _LOADED = True
            _LOADED_PATH = env_path
            return env_path

    _LOADED = True
    _LOADED_PATH = None
    return None
