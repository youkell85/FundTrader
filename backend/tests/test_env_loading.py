import os

from app import env as backend_env


def test_load_backend_env_prefers_backend_env_file(tmp_path, monkeypatch):
    backend_file = tmp_path / "backend.env"
    project_file = tmp_path / "project.env"
    backend_file.write_text("TUSHARE_TOKEN=from_backend\n", encoding="utf-8")
    project_file.write_text("TUSHARE_TOKEN=from_project\n", encoding="utf-8")

    monkeypatch.delenv("TUSHARE_TOKEN", raising=False)
    monkeypatch.setattr(backend_env, "_LOADED", False)
    monkeypatch.setattr(backend_env, "_LOADED_PATH", None)
    monkeypatch.setattr(backend_env, "get_backend_env_path", lambda: backend_file)
    monkeypatch.setattr(backend_env, "get_project_env_path", lambda: project_file)

    loaded_path = backend_env.load_backend_env()

    assert loaded_path == backend_file
    assert os.environ["TUSHARE_TOKEN"] == "from_backend"
