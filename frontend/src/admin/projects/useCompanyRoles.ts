import { useEffect, useState } from 'react'

import { listCompanyRoles, type CompanyRole } from './api'

/**
 * DOM-R76：讀取後端的本公司角色登記表，供畫面把角色值對成中文標籤。
 * 載入失敗或尚未載入時回傳空清單，呼叫端退回顯示原值，不擋住頁面。
 */
export function useCompanyRoles(): CompanyRole[] {
  const [roles, setRoles] = useState<CompanyRole[]>([])
  useEffect(() => {
    let active = true
    listCompanyRoles()
      .then((items) => {
        if (active) setRoles(items)
      })
      .catch(() => {
        // 標籤只是顯示用；失敗時顯示角色值，不另外報錯。
      })
    return () => {
      active = false
    }
  }, [])
  return roles
}
