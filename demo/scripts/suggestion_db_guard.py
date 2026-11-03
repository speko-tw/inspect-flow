#!/usr/bin/env python3
"""PostgreSQL 驗收庫守門：確認最終連線目標是本機的測試庫。

為什麼：runner 會清空目標資料庫的 public schema。只看網址路徑不夠，
`?dbname=`、`?host=`、`?service=` 等查詢參數可以在連線時覆寫實際目標，
路徑看起來是測試庫、實際清的卻是別的庫。這裡拒絕任何查詢參數，並用
SQLAlchemy 實際組出的連線參數再核對一次資料庫名稱。

用法：
  suggestion_db_guard.py URL        通過時印出資料庫名稱，否則以 2 結束
  suggestion_db_guard.py --self-test  反例自測，全部符合預期才以 0 結束
"""

import sys

from sqlalchemy.engine import make_url

LOOPBACK = frozenset({"127.0.0.1", "localhost", "::1"})


def check(text: str) -> str:
    """回傳通過守門的資料庫名稱；不符合時丟出 ValueError。"""
    url = make_url(text)
    if not url.drivername.startswith("postgresql"):
        raise ValueError("只接受 PostgreSQL 網址")
    if url.query:
        raise ValueError(
            "網址不得帶查詢參數（可能覆寫連線目標）："
            + ",".join(sorted(url.query))
        )
    if url.host not in LOOPBACK:
        raise ValueError(f"只接受本機主機，收到 {url.host!r}")
    name = url.database or ""
    if not name or ("test" not in name and "e2e" not in name):
        raise ValueError(f"資料庫名稱必須含 test 或 e2e，收到 {name!r}")
    # 以實際連線參數再核對，避免網址解析與驅動解析不一致。
    _, kwargs = url.get_dialect()().create_connect_args(url)
    final = kwargs.get("dbname") or kwargs.get("database")
    if final != name:
        raise ValueError(f"最終連線資料庫 {final!r} 與網址 {name!r} 不同")
    return name


def self_test() -> int:
    """反例自測：好的網址通過，會改寫目標或指向非測試庫的都被拒。"""
    base = "postgresql+psycopg://u:p@127.0.0.1:55432/"
    accepted = [base + "inspectflow_test_807", base + "inspectflow_e2e_807"]
    rejected = [
        base + "inspectflow_test?dbname=inspectflow",
        base + "inspectflow_test_807?host=db.example.com",
        base + "inspectflow_test_807?service=prod",
        base + "inspectflow_test_807?options=-csearch_path%3Dpublic",
        base + "inspectflow",
        base,
        "postgresql+psycopg://u:p@db.example.com:5432/inspectflow_test",
        "sqlite:///tmp/inspectflow_test.db",
    ]
    failures = []
    for text in accepted:
        try:
            check(text)
        except ValueError as error:
            failures.append(f"應通過卻被拒：{text}（{error}）")
    for text in rejected:
        try:
            check(text)
        except ValueError:
            continue
        failures.append(f"應被拒卻通過：{text}")
    for line in failures:
        print(line, file=sys.stderr)
    print(
        f"guard self-test: {len(accepted)} accepted, "
        f"{len(rejected)} rejected, {len(failures)} failures"
    )
    return 1 if failures else 0


def main() -> int:
    """入口：自測，或檢查單一網址。"""
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        return self_test()
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        print(check(sys.argv[1]))
    except ValueError as error:
        print(f"拒絕：{error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
