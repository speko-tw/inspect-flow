"""Registers every concrete model module on ``Base.metadata``.

Adding a new model only means importing its module here -- Alembic's
``env.py`` imports this package as a whole (see its own docstring)
so each model registers its table as a side effect of that import;
``env.py`` itself does not change when a model is added.
"""

from app.models.audit_log import AuditLog
from app.models.auth_session import AuthSession
from app.models.company import Company
from app.models.login_counter import LoginCounter
from app.models.login_failure import LoginFailure
from app.models.project import Project
from app.models.project_member import ProjectMember, ProjectMemberRole
from app.models.role import Role, RolePermission
from app.models.setup_code import SetupCode
from app.models.user import User
from app.models.user_password import UserPassword

__all__ = [
    "AuditLog",
    "AuthSession",
    "Company",
    "LoginCounter",
    "LoginFailure",
    "Project",
    "ProjectMember",
    "ProjectMemberRole",
    "Role",
    "RolePermission",
    "SetupCode",
    "User",
    "UserPassword",
]
