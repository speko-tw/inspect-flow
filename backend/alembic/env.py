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
"""

import importlib.util
from importlib import import_module
from logging.config import fileConfig

from alembic import context
from app.db.base import Base
from app.db.engine import create_engine_from_settings
from app.db.settings import get_database_url

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# See this module's docstring: app/models (introduced in a later
# task) registers its models on Base.metadata as a side effect of
# being imported.
if importlib.util.find_spec("app.models") is not None:
    import_module("app.models")

target_metadata = Base.metadata


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

    """
    connectable = create_engine_from_settings(get_database_url())
    is_sqlite = connectable.dialect.name == "sqlite"

    try:
        with connectable.connect() as connection:
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
            )

            with context.begin_transaction():
                context.run_migrations()
    finally:
        connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
