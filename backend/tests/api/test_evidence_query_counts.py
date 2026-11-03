"""FEV T3：照片、項次與圖層歷程數量不造成 N+1 查詢。"""

from tests.api.query_count import select_count
from tests.api.test_evidence_read import (
    _add_photo,
    _clone_photos,
    _paths,
)
from tests.api.test_evidence_read import (
    read_world as read_world,
)


def test_batched_reads_have_constant_select_count(read_world):
    w = read_world
    _add_photo(w)
    base, field, _ = _paths(w)
    probes = (
        (w["reader"], base),
        (w["field"], field + "/photos"),
        (w["field"], field + "/evidence"),
    )
    small = [select_count(client, path, limit=100) for client, path in probes]
    assert all(count > 0 and size == 1 for count, size in small)
    _clone_photos(w, 99)
    large = [select_count(client, path, limit=100) for client, path in probes]
    assert [size for _, size in large] == [100, 100, 1]
    assert [count for count, _ in small] == [count for count, _ in large]
