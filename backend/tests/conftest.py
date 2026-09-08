"""Test fixtures.

Every test runs against a throwaway SQLite file built by the real Alembic
migrations, so a broken revision fails the suite rather than production.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session", autouse=True)
def _database(tmp_path_factory) -> None:
    # Set before anything imports `app`, which builds its engine at import time.
    db_path = tmp_path_factory.mktemp("db") / "test.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    os.environ.setdefault("GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com")
    os.environ.setdefault("JWT_SECRET", "test-secret-that-is-long-enough-for-sha256")

    from alembic import command
    from alembic.config import Config

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    command.upgrade(config, "head")


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as test_client:
        yield test_client
