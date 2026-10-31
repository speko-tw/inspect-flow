"""FEV-AC01：儲存契約、隔離與失敗清理。"""

import io
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from app.storage import LocalStorage, Storage


def test_stream_roundtrip_and_retryable_delete(tmp_path: Path) -> None:
    storage: Storage = LocalStorage(tmp_path / "photos")
    payload = b"jpeg bytes" * 20_000
    key = storage.save(io.BytesIO(payload))
    assert isinstance(key, UUID)
    assert list(storage.iter_keys()) == [key]
    assert [p.name for p in (tmp_path / "photos").iterdir()] == [str(key)]
    with storage.open(key) as source:
        assert source.read() == payload
        assert not source.writable()
    storage.delete(key)
    storage.delete(key)
    assert list(storage.iter_keys()) == []
    with pytest.raises(FileNotFoundError):
        storage.open(key)


def test_failed_stream_leaves_no_file(tmp_path: Path) -> None:
    class BrokenSource(io.BytesIO):
        def read(self, size: int = -1) -> bytes:
            if self.tell():
                raise OSError("interrupted upload")
            return super().read(size)

    storage = LocalStorage(tmp_path)
    with pytest.raises(OSError, match="interrupted"):
        storage.save(BrokenSource(b"x" * 100_000))
    assert list(tmp_path.iterdir()) == []


def test_parallel_writes_never_overwrite(tmp_path: Path) -> None:
    storage = LocalStorage(tmp_path)
    payloads = [str(index).encode() for index in range(12)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        keys = list(pool.map(lambda b: storage.save(io.BytesIO(b)), payloads))
    assert len(set(keys)) == len(payloads)
    for key, payload in zip(keys, payloads, strict=True):
        with storage.open(key) as source:
            assert source.read() == payload


@pytest.mark.parametrize("key", ["../secret", "/etc/passwd", "photo.jpg"])
def test_rejects_user_supplied_paths(tmp_path: Path, key) -> None:
    storage = LocalStorage(tmp_path)
    for operation in (storage.open, storage.delete):
        with pytest.raises(ValueError, match="UUID"):
            operation(key)


def test_symlink_cannot_escape_root(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.write_bytes(b"private")
    root = tmp_path / "photos"
    root.mkdir()
    key = uuid4()
    (root / str(key)).symlink_to(outside)
    storage = LocalStorage(root)
    for operation in (storage.open, storage.delete):
        with pytest.raises(ValueError, match="symlinks"):
            operation(key)
    with pytest.raises(ValueError, match="symlinks"):
        list(storage.iter_keys())
    assert outside.read_bytes() == b"private"


def test_uuid_collision_does_not_overwrite(tmp_path: Path, monkeypatch):
    storage = LocalStorage(tmp_path)
    key = storage.save(io.BytesIO(b"original"))
    monkeypatch.setattr("app.storage.local.uuid4", lambda: key)
    with pytest.raises(FileExistsError):
        storage.save(io.BytesIO(b"replacement"))
    with storage.open(key) as source:
        assert source.read() == b"original"


def test_inventory_does_not_create_or_ignore_entries(tmp_path: Path):
    root = tmp_path / "missing"
    assert list(LocalStorage(root).iter_keys()) == []
    assert not root.exists()
    root.mkdir()
    (root / "unexpected.jpg").write_bytes(b"file")
    with pytest.raises(ValueError):
        list(LocalStorage(root).iter_keys())
