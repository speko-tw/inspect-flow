"""Shared database access layer (database-foundation spec, T1).

Submodules:

- ``settings``: resolves the SQLAlchemy connection URL from the
  environment (DBF-R05).
- ``clock``: a replaceable UTC time source for automatic
  timestamp columns (DBF-R14).
- ``engine``: lazily builds the SQLAlchemy engine and session
  factory, including SQLite connection initialization (DBF-R04,
  DBF-R06).
- ``base``: the declarative base, shared UUID/timestamp columns,
  and the UTC-aware datetime type (DBF-R08, DBF-R11, DBF-R14).
- ``unit_of_work``: the commit-or-rollback transaction scope used
  by the Service layer (DBF-R09).
"""
