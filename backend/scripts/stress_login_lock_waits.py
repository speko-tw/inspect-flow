"""Measure login responses while SQLite's single writer lock is held.

Run from the repository root with:

    cd backend && PYTHONPATH=. .venv/bin/python \
        scripts/stress_login_lock_waits.py

This is a deliberately manual stress probe; normal checks use the
deterministic lock-timeout test in ``tests/auth/test_login_lockout.py``.
"""

import argparse
import os
import statistics
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from alembic import command
from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.db.engine import create_engine_from_settings, dispose_engine
from app.db.settings import DATABASE_URL_ENV_VAR
from app.main import create_app
from tests.auth.conftest import DEFAULT_TEST_PASSWORD, make_local_user


def _measure_one(app, login: str, password: str) -> float:
    with TestClient(app, base_url="https://testserver") as client:
        started = time.monotonic()
        response = client.post(
            "/api/v1/auth/login",
            json={"login": login, "password": password},
        )
        if response.status_code != 503:
            raise RuntimeError(
                f"expected 503 while writer lock is held, got "
                f"{response.status_code}: {response.text}"
            )
        return time.monotonic() - started


def _measure_database_read(app) -> float:
    with TestClient(app, base_url="https://testserver") as client:
        started = time.monotonic()
        response = client.get(
            "/api/v1/auth/me",
            cookies={SESSION_COOKIE_NAME: "unknown-session-token"},
        )
        elapsed = time.monotonic() - started
        if response.status_code != 401:
            raise RuntimeError(
                "expected an unauthenticated database lookup to return "
                f"401, got {response.status_code}: {response.text}"
            )
        return elapsed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout-ms", type=int, default=250)
    parser.add_argument("--repeats", type=int, default=3)
    args = parser.parse_args()
    if args.timeout_ms < 1 or not 1 <= args.repeats <= 50:
        parser.error("--timeout-ms and --repeats must be positive")

    backend_dir = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="inspect-flow-login-stress-") as d:
        database_path = Path(d) / "stress.db"
        os.environ[DATABASE_URL_ENV_VAR] = f"sqlite:///{database_path}"
        os.environ["INSPECTFLOW_SQLITE_BUSY_TIMEOUT_MS"] = str(args.timeout_ms)
        dispose_engine()

        alembic_config = Config(str(backend_dir / "alembic.ini"))
        command.upgrade(alembic_config, "head")
        app_engine = create_engine_from_settings()
        with Session(app_engine) as session:
            user = make_local_user(session, "STRESS_LOGIN")
            known_login = user.email
            if known_login is None:
                raise RuntimeError("stress user must have an email")
            _auth_session, session_token = create_session(session, user)
            session.commit()
        app_engine.dispose()

        app = create_app()
        known_times = []
        unknown_times = []
        read_times = []
        holder_engine = create_engine(f"sqlite:///{database_path}")
        try:
            with holder_engine.connect() as holder:
                holder.exec_driver_sql("BEGIN IMMEDIATE")
                try:
                    with ThreadPoolExecutor(
                        max_workers=args.repeats * 3
                    ) as pool:
                        known_futures = [
                            pool.submit(
                                _measure_one,
                                app,
                                known_login,
                                DEFAULT_TEST_PASSWORD,
                            )
                            for _ in range(args.repeats)
                        ]
                        unknown_futures = [
                            pool.submit(
                                _measure_one,
                                app,
                                "missing-user",
                                "wrong-password",
                            )
                            for _ in range(args.repeats)
                        ]
                        read_futures = [
                            pool.submit(_measure_database_read, app)
                            for _ in range(args.repeats)
                        ]
                        known_times = [
                            future.result() for future in known_futures
                        ]
                        unknown_times = [
                            future.result() for future in unknown_futures
                        ]
                        read_times = [
                            future.result() for future in read_futures
                        ]
                finally:
                    holder.rollback()

            with TestClient(app, base_url="https://testserver") as client:
                known_after = client.post(
                    "/api/v1/auth/login",
                    json={
                        "login": known_login,
                        "password": DEFAULT_TEST_PASSWORD,
                    },
                )
                unknown_after = client.post(
                    "/api/v1/auth/login",
                    json={
                        "login": "missing-user",
                        "password": "wrong-password",
                    },
                )
                if known_after.status_code != 200:
                    raise RuntimeError(
                        "known login did not recover after releasing lock: "
                        f"{known_after.status_code}"
                    )
                if unknown_after.status_code != 401:
                    raise RuntimeError(
                        "unknown login did not recover after releasing lock: "
                        f"{unknown_after.status_code}"
                    )
                me_after = client.get(
                    "/api/v1/auth/me",
                    cookies={SESSION_COOKIE_NAME: session_token},
                )
                if me_after.status_code != 200:
                    raise RuntimeError(
                        "database-backed /auth/me did not recover after "
                        f"releasing lock: {me_after.status_code}"
                    )
        finally:
            holder_engine.dispose()
            dispose_engine()

    for label, samples in (
        ("known", known_times),
        ("unknown", unknown_times),
        ("db-read", read_times),
    ):
        print(
            f"{label}: n={len(samples)} "
            f"min={min(samples):.3f}s "
            f"median={statistics.median(samples):.3f}s "
            f"max={max(samples):.3f}s"
        )
    print("during lock: db-read=401; after lock release: known=200")
    print("after lock release: unknown=401 db-read-authenticated=200")


if __name__ == "__main__":
    main()
