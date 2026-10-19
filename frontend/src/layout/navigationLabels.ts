/** 全站導覽與頁面標題的共用文案，避免名稱在多個入口分散維護。 */
export const NAV_LABELS = {
  tasks: '任務',
  projects: '專案',
  overview: '總覽',
  templates: '範本',
  management: '管理',
  account: '帳號',
  company: '公司',
  roles: '角色',
  records: '紀錄',
  settings: '設定',
  logout: '登出',
} as const

/** 各主要頁面的完整標題，供頁面與導覽直接共用。 */
export const PAGE_TITLES = {
  tasks: '我的任務',
  projects: '專案',
  overview: '總覽',
  templates: '查核範本',
  account: '帳號',
  company: '公司',
  projectRoles: '專案角色',
  records: '操作紀錄',
  personalSettings: '個人設定',
} as const

/** 帳號管理分頁與其完整頁面標題共用同一個值。 */
export const ACCOUNT_LABEL = PAGE_TITLES.account
