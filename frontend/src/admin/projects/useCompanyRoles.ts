import { useEffect, useState } from 'react'

import { listCompanyRoles, type CompanyRole } from './api'

export type CompanyRolesState = {
  roles: CompanyRole[]
  /** 讓呼叫端分辨「還在載入」與「載入失敗」，兩者的畫面不同。 */
  status: 'loading' | 'ready' | 'error'
}

/**
 * DOM-R76：讀取後端的本公司角色登記表，供畫面把角色值對成中文標籤。
 * 載入中先不要顯示角色值（英文值會閃一下再換成中文）；失敗時才讓
 * 呼叫端退回顯示原值，不擋住頁面。
 */
export function useCompanyRoles(): CompanyRolesState {
  const [state, setState] = useState<CompanyRolesState>({
    roles: [],
    status: 'loading',
  })
  useEffect(() => {
    let active = true
    listCompanyRoles()
      .then((items) => {
        if (active) setState({ roles: items, status: 'ready' })
      })
      .catch(() => {
        // 標籤只是顯示用；失敗時顯示角色值，不另外報錯。
        if (active) setState({ roles: [], status: 'error' })
      })
    return () => {
      active = false
    }
  }, [])
  return state
}
