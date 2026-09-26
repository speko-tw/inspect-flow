"""Transactional unit of work for the Service layer (DBF-R09).

Wraps a single ORM session so a Service-layer request's writes are
all-or-nothing: the managed block's writes commit together when it
completes normally, and roll back together if it raises. The API
layer never assembles SQL itself; it goes through the Service
layer, which uses this unit of work around its session.
"""

from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy.orm import Session, sessionmaker

from app.db.engine import get_session_factory


@contextmanager
def unit_of_work(
    session_factory: sessionmaker[Session] | None = None,
) -> Generator[Session, None, None]:
    """Yield a ``Session`` scoped to one commit-or-rollback unit.

    Commits when the ``with`` block exits normally. Any exception
    raised inside the block triggers a rollback and is then
    re-raised unchanged -- this unit of work never swallows an
    exception on the caller's behalf. The session is always closed
    on the way out, whether the block succeeded or raised.
    """
    factory = session_factory or get_session_factory()
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
