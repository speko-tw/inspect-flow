"""FEV-AC07：資源上限可調，設定解析不產生檔案。"""

from pathlib import Path

import pytest

from app.storage import get_storage_settings

_NAMES = (
    "INSPECTFLOW_EVIDENCE_STORAGE_ROOT",
    "INSPECTFLOW_EVIDENCE_MAX_FILE_BYTES",
    "INSPECTFLOW_EVIDENCE_MAX_DECODE_PIXELS",
)


@pytest.fixture(autouse=True)
def clean_settings(monkeypatch):
    for name in _NAMES:
        monkeypatch.delenv(name, raising=False)


def test_defaults_and_empty_values_are_cwd_independent(monkeypatch, tmp_path):
    settings = get_storage_settings()
    assert settings.root == Path(__file__).resolve().parents[2] / (
        "data/evidence"
    )
    assert settings.max_file_bytes == 30 * 1024 * 1024
    assert settings.max_decode_pixels == 50_000_000
    monkeypatch.chdir(tmp_path)
    for name in _NAMES:
        monkeypatch.setenv(name, "")
    assert get_storage_settings() == settings


def test_custom_settings(monkeypatch, tmp_path):
    for name, value in zip(
        _NAMES, (str(tmp_path / "photos"), "123", "456"), strict=True
    ):
        monkeypatch.setenv(name, value)
    settings = get_storage_settings()
    assert settings.root == tmp_path / "photos"
    assert settings.max_file_bytes == 123
    assert settings.max_decode_pixels == 456
    assert not settings.root.exists()


@pytest.mark.parametrize("name", _NAMES[1:])
@pytest.mark.parametrize("value", ["0", "-1", "1.5", "abc", " 1", "１"])
def test_invalid_limits_fail(name, value, monkeypatch):
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError, match=name):
        get_storage_settings()


def test_relative_root_fails(monkeypatch):
    monkeypatch.setenv(_NAMES[0], "relative/photos")
    with pytest.raises(ValueError, match=_NAMES[0]):
        get_storage_settings()
