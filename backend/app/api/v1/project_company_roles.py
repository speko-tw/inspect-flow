"""專案可選的本公司角色清單，唯讀（DOM-R76）。"""

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
    """一個登記過的本公司角色：資料庫存的值、畫面標籤與檢查層級。

    ``inspection_level`` 一併回傳，之後任務建立依角色帶入層級時，
    前端不必另外維護一份對照（IP-R16）。
    """

    value: str
    label: str
    inspection_level: str


class CompanyRoleListResponse(BaseModel):
    """角色清單回應；依登記順序排列，不分頁、不帶 cursor。"""

    items: list[CompanyRoleResponse]


@router.get("", response_model=CompanyRoleListResponse)
def get_project_company_roles() -> CompanyRoleListResponse:
    """依登記順序回傳目前登記的角色（DOM-R76）。

    新增專案與專案設定畫面的選項都讀這裡，不在前端寫死（ADM-R40）；
    登記表只有少數幾筆，所以不做分頁。任何登入者都能讀，因為清單
    本身不含專案資料。
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
