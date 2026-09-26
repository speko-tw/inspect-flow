"""Registers every concrete model module on ``Base.metadata``.

Adding a new model only means importing its module here -- Alembic's
``env.py`` imports this package as a whole (see its own docstring)
so each model registers its table as a side effect of that import;
``env.py`` itself does not change when a model is added.
"""

from app.models.company import Company
from app.models.project import Project
from app.models.user import User

__all__ = ["Company", "Project", "User"]
