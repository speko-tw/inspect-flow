/**
 * 導覽名稱與畫面標題的單一來源，
 * 避免相同用語在入口間分歧。
 */
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

/** 各主要頁面的完整標題，供路由、頁面與導覽共用。 */
export const PAGE_TITLES = {
  home: '首頁',
  login: '登入',
  setup: '初始設定',
  admin: '管理',
  tasks: '我的任務',
  projects: '專案',
  myProjects: '我的專案',
  overview: '總覽',
  templates: '查核範本',
  account: '帳號',
  company: '公司',
  projectRoles: '專案角色',
  records: '操作紀錄',
  personalSettings: '個人設定',
  projectHome: '專案首頁',
  projectNew: '新增專案',
  projectEdit: '修改專案',
  projectMembers: '成員',
  projectMemberNew: '加入成員',
  projectMemberEdit: '修改成員角色',
  projectItems: '查核項目',
  projectZones: '分區',
  projectZoneNew: '新增分區',
  projectPlanning: '計畫與任務',
  projectProgress: '進度',
  projectTask: '任務詳情',
  projectItemChange: '修改專案查核項目',
} as const

/** 帳號管理頁面使用的共用名稱。 */
export const ACCOUNT_LABEL = PAGE_TITLES.account

export type LandingLabelKey =
  'account' | 'projects' | 'overview' | 'templates' | 'settings' | 'tasks'

const LANDING_LABELS: Record<LandingLabelKey, string> = {
  account: PAGE_TITLES.account,
  projects: PAGE_TITLES.projects,
  overview: PAGE_TITLES.overview,
  templates: PAGE_TITLES.templates,
  settings: PAGE_TITLES.personalSettings,
  tasks: PAGE_TITLES.tasks,
}

/** 取得登入落點連結使用的白話名稱。 */
export function landingLabel(key: LandingLabelKey): string {
  return LANDING_LABELS[key]
}

/** UDS-R10：外觀選項沿用白話名稱，不把技術值當作畫面文字。 */
export const APPEARANCE_LABELS = {
  system: '跟隨裝置（預設）',
  light: '淺色',
  dark: '深色',
} as const
