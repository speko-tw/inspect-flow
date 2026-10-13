"""本公司角色登記表（DOM-R76）。

``Project.company_role`` 只能存這裡登記過的值，但登記表不是資料表：
放在程式內，新增角色只需在此加一筆，不必改資料表或 migration
（DOM-R76「不用資料庫 enum」），做法比照 ``app/permission_codes.py``
的權限碼登記表（DOM-R35）。

角色標籤與檢查層級分開登記（KD-51）：之後新增 PCM（二級）只要加標籤
並指定它的層級，其他角色（例如第三方檢驗）加入時再決定它屬哪一級、
要出哪種報表。檢查層級的值（``self_inspection``、``spot_check``）取自
``inspection-planning`` IP-R16，任務建立時會依專案當時的角色帶入。

測試要登記臨時角色值時，用 ``tests`` 的 fixture 把 ``_registry`` 換成
含臨時項目的副本；本模組的查詢函式一律讀 ``_registry``，所以換掉後
model 寫入檢查與唯讀端點都會一起看到。
"""

from dataclasses import dataclass

# 檢查層級的列舉值（IP-R16）：一級自主檢查、二級抽查（驗）。
SELF_INSPECTION = "self_inspection"
SPOT_CHECK = "spot_check"

# DOM-R76：建立專案時呼叫端得省略角色，省略即承攬施工方；前端仍必須
# 明確送出選取值（ADM-R40），不依賴這個預設。
DEFAULT_COMPANY_ROLE = "contractor"

# 登記表值的長度上限，也是 ``Project.company_role`` 欄位的長度。
COMPANY_ROLE_MAX_LENGTH = 32


@dataclass(frozen=True)
class CompanyRoleDefinition:
    """一個本公司角色：資料庫存 ``value``，畫面顯示 ``label``。"""

    value: str
    label: str
    inspection_level: str


# 順序即 ``GET /api/v1/project-company-roles`` 的回傳順序（DOM-R76）。
_DEFAULT_REGISTRY: tuple[CompanyRoleDefinition, ...] = (
    CompanyRoleDefinition("contractor", "承攬施工方", SELF_INSPECTION),
    CompanyRoleDefinition("supervisor", "監造方", SPOT_CHECK),
)

# 正式環境永遠是 ``_DEFAULT_REGISTRY``；只有測試 fixture 會暫時換掉。
_registry: tuple[CompanyRoleDefinition, ...] = _DEFAULT_REGISTRY


def list_company_roles() -> tuple[CompanyRoleDefinition, ...]:
    """依登記順序回傳目前登記的本公司角色。"""
    return _registry


def get_company_role(value: str) -> CompanyRoleDefinition | None:
    """回傳登記過的角色定義；未登記回 ``None``。"""
    for definition in _registry:
        if definition.value == value:
            return definition
    return None


def is_company_role_registered(value: str) -> bool:
    """DOM-R76：``value`` 是否為目前登記的本公司角色。"""
    return get_company_role(value) is not None


def company_role_label(value: str) -> str | None:
    """回傳角色的中文標籤；未登記回 ``None``。"""
    definition = get_company_role(value)
    return definition.label if definition else None


def company_role_inspection_level(value: str) -> str | None:
    """回傳角色對應的檢查層級；未登記回 ``None``。

    任務建立時由 ``inspection-planning`` 依專案當時角色帶入（IP-R16）。
    """
    definition = get_company_role(value)
    return definition.inspection_level if definition else None
