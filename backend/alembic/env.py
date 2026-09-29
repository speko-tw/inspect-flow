"""Alembic environment (DBF-R02, DBF-R05).

Binds Alembic to the same connection URL and metadata the
application uses, so migrations and the app never disagree about
either:

- The connection URL comes from
  ``app.db.settings.get_database_url()``, which reads the
  ``INSPECTFLOW_DATABASE_URL`` environment variable -- not from
  ``sqlalchemy.url`` in ``alembic.ini`` (deliberately left unset).
- ``target_metadata`` is ``app.db.base.Base.metadata``, the same
  declarative metadata production models register on.

Convention for later tasks: once ``app/models`` exists (T4
onwards), its ``__init__.py`` is expected to import every concrete
model module so each one registers its table on ``Base.metadata``
before autogenerate compares against it. This module only needs to
import the ``app.models`` package itself (if present) to trigger
that; it does not need to change when new models are added.

``render_item`` below is the other half of #139's rule (enforced by
``tests/db/test_db_access_rules.py``'s
``test_no_app_imports_in_migrations``): a generated migration must
only use SQLAlchemy's built-in types and must never import ``app``.
Left to its default rendering, autogenerate would otherwise write
out an app-defined ``TypeDecorator`` (e.g. ``app.db.base.UTCDateTime``,
``app.models._bounded_string.BoundedString``) verbatim, plus an
``import app...`` line to go with it. ``render_item`` intercepts
each of those two types and renders their SQLAlchemy-built-in
``impl`` instead, so the generated script never needs that import.
Adding another app-defined column type later means adding a case
here too, or ``test_no_app_imports_in_migrations`` will fail on the
next autogenerate run that touches it (#199).

``run_migrations_online``'s connection carries the
``audit_log_ddl_allowed=True`` execution option (ALG-R04, issue
#233's fifth PR review round): ``app/models/audit_log.py``'s
append-only guard rejects any ``DROP TABLE``/``ALTER TABLE`` reaching
``audit_logs`` (a migration script's own job -- this table's own
migration creates it, and downgrading drops it again) *unless* the
connection running the statement was opened with that option set.
The string must match that module's ``_DDL_ALLOWED_OPTION`` exactly;
it is not imported from there to avoid a private, underscore-prefixed
import across modules for what SQLAlchemy itself treats as a
conventionally-named keyword argument (like its own built-in
execution options, e.g. ``isolation_level``), not a shared symbol.
The option affects only that one DDL check: it does not, and must
not, let a migration ``UPDATE``/``DELETE``/``TRUNCATE`` this table.
"""

import importlib.util
from importlib import import_module
from logging.config import fileConfig
from typing import Literal

from alembic.autogenerate.api import AutogenContext

from alembic import context
from app.db.base import Base, UTCDateTime
from app.db.engine import create_engine_from_settings
from app.db.settings import get_database_url
from app.models._bounded_string import BoundedString

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
#
# ``disable_existing_loggers=False``: when migrations run in the
# same process as the application or a test (not just Alembic's own
# CLI), loggers other code already created (e.g. ``app.api.errors``)
# must stay enabled afterwards -- fileConfig's default disables
# every logger not named in the ini file.
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# See this module's docstring: app/models (introduced in a later
# task) registers its models on Base.metadata as a side effect of
# being imported.
if importlib.util.find_spec("app.models") is not None:
    import_module("app.models")

target_metadata = Base.metadata


def render_item(
    type_: str, obj: object, autogen_context: AutogenContext
) -> str | Literal[False]:
    """Render an app-defined column type as its SQLAlchemy
    built-in ``impl`` instead of the app's own class (see this
    module's docstring, #139/#199).

    Returning ``False`` for anything else keeps autogenerate's
    default rendering for every other item kind and type.
    """
    if type_ == "type":
        if isinstance(obj, UTCDateTime):
            return "sa.DateTime(timezone=True)"
        if isinstance(obj, BoundedString):
            return f"sa.String(length={obj.length})"
    return False


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = get_database_url()
    is_sqlite = url.startswith("sqlite")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=is_sqlite,
        compare_type=True,
        render_item=render_item,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    Builds the engine through
    ``app.db.engine.create_engine_from_settings`` (not
    ``engine_from_config``) so a SQLite target gets the same
    parent-directory creation and connection PRAGMAs
    (``foreign_keys``, WAL) the application itself relies on.

    See this module's docstring for ``audit_log_ddl_allowed``, set
    on ``connection`` below so this run's DDL can reach
    ``audit_logs`` (ALG-R04's append-only guard would otherwise
    reject this table's own migration).
    """
    connectable = create_engine_from_settings(get_database_url())
    is_sqlite = connectable.dialect.name == "sqlite"

    try:
        with connectable.connect() as connection:
            connection.execution_options(audit_log_ddl_allowed=True)
            context.configure(
                connection=connection,
                target_metadata=target_metadata,
                # SQLite's ALTER TABLE support is limited; batch
                # mode rebuilds the table under the hood so later
                # migrations (once there are non-baseline ones)
                # can alter SQLite tables the same way they alter
                # other dialects.
                render_as_batch=is_sqlite,
                compare_type=True,
                render_item=render_item,
            )

            with context.begin_transaction():
                context.run_migrations()
    finally:
        connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
