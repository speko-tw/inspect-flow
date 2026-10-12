"""Read-only list of company roles a project can take (DOM-R76)."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.access import require_login_access
from app.company_roles import list_company_roles

router = APIRouter(
    prefix="/project-company-roles",
    tags=["projects"],
    dependencies=[Depends(require_login_access)],
)


class CompanyRoleResponse(BaseModel):
    """One registered company role: stored value, label, check level."""

    value: str
    label: str
    inspection_level: str


class CompanyRoleListResponse(BaseModel):
    items: list[CompanyRoleResponse]


@router.get("", response_model=CompanyRoleListResponse)
def get_project_company_roles() -> CompanyRoleListResponse:
    """List the registered roles in registry order (DOM-R76).

    The new-project and project-settings screens read their options
    here instead of hard-coding them (ADM-R40); the list is short, so it
    is not paginated.
    """
    return CompanyRoleListResponse(
        items=[
            CompanyRoleResponse(
                value=role.value,
                label=role.label,
                inspection_level=role.inspection_level,
            )
            for role in list_company_roles()
        ]
    )


__all__ = ["router"]
