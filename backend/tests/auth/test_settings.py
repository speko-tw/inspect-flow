"""Auth environment settings must be positive integers (#293)."""

from datetime import timedelta

import pytest

from app.auth.settings import (
    ABSOLUTE_TIMEOUT_ENV_VAR,
    FAILURE_THRESHOLD_ENV_VAR,
    FAILURE_WINDOW_ENV_VAR,
    IDLE_TIMEOUT_ENV_VAR,
    LOCKOUT_DURATION_ENV_VAR,
    SETUP_FAILURE_THRESHOLD_ENV_VAR,
    SETUP_FAILURE_WINDOW_ENV_VAR,
    SETUP_LOCKOUT_DURATION_ENV_VAR,
    InvalidAuthSettingError,
    get_lockout_settings,
    get_session_timeouts,
    get_setup_lockout_settings,
    validate_auth_settings,
)
from app.main import create_app

ALL_ENV_VARS = (
    IDLE_TIMEOUT_ENV_VAR,
    ABSOLUTE_TIMEOUT_ENV_VAR,
    FAILURE_THRESHOLD_ENV_VAR,
    FAILURE_WINDOW_ENV_VAR,
    LOCKOUT_DURATION_ENV_VAR,
    SETUP_FAILURE_THRESHOLD_ENV_VAR,
    SETUP_FAILURE_WINDOW_ENV_VAR,
    SETUP_LOCKOUT_DURATION_ENV_VAR,
)

BAD_VALUES = ("0", "-1", "1.5", "abc", "1e3")


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ALL_ENV_VARS:
        monkeypatch.delenv(name, raising=False)


@pytest.mark.parametrize("name", ALL_ENV_VARS)
@pytest.mark.parametrize("value", BAD_VALUES)
def test_invalid_value_names_the_variable(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(InvalidAuthSettingError, match=name):
        validate_auth_settings()


@pytest.mark.parametrize(
    "name", [n for n in ALL_ENV_VARS if "THRESHOLD" not in n]
)
def test_duration_too_large_is_rejected(monkeypatch, name):
    monkeypatch.setenv(name, "99999999999999999999")
    with pytest.raises(InvalidAuthSettingError, match=name):
        validate_auth_settings()


@pytest.mark.parametrize("name", ALL_ENV_VARS)
def test_invalid_value_stops_app_startup(monkeypatch, name):
    monkeypatch.setenv(name, "0")
    with pytest.raises(InvalidAuthSettingError, match=name):
        create_app()


def test_getters_reject_invalid_values(monkeypatch):
    monkeypatch.setenv(IDLE_TIMEOUT_ENV_VAR, "-5")
    with pytest.raises(InvalidAuthSettingError):
        get_session_timeouts()
    monkeypatch.setenv(FAILURE_THRESHOLD_ENV_VAR, "0")
    with pytest.raises(InvalidAuthSettingError):
        get_lockout_settings()
    monkeypatch.setenv(SETUP_LOCKOUT_DURATION_ENV_VAR, "x")
    with pytest.raises(InvalidAuthSettingError):
        get_setup_lockout_settings()


def test_unset_and_empty_use_defaults(monkeypatch):
    validate_auth_settings()
    assert get_session_timeouts().idle_timeout == timedelta(minutes=60)
    assert get_session_timeouts().absolute_timeout == timedelta(hours=8)
    for name in ALL_ENV_VARS:
        monkeypatch.setenv(name, "")
    validate_auth_settings()
    assert get_lockout_settings().failure_threshold == 10
    assert get_setup_lockout_settings().lockout_duration == timedelta(
        minutes=15
    )


def test_positive_integers_are_accepted(monkeypatch):
    for name in ALL_ENV_VARS:
        monkeypatch.setenv(name, " 3 ")
    validate_auth_settings()
    assert get_session_timeouts().idle_timeout == timedelta(minutes=3)
    assert get_session_timeouts().absolute_timeout == timedelta(hours=3)
    assert get_lockout_settings().failure_threshold == 3
    assert get_setup_lockout_settings().failure_window == timedelta(minutes=3)
