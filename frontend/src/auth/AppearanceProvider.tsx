import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react'

import { saveAppearance } from './api'
import { applyAppearance, type Appearance } from './appearance'

interface AppearanceContextValue {
  preference: Appearance
  savePreference: (value: Appearance) => Promise<void>
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null)

/** AUT-R55：以帳號為生命週期，避免前一帳號的晚到回應覆蓋新主題。 */
export function AppearanceProvider({
  initialAppearance,
  children,
}: {
  initialAppearance: Appearance
  children: ReactNode
}) {
  const [preference, setPreference] = useState(initialAppearance)

  useLayoutEffect(() => {
    applyAppearance(preference)
  }, [preference])

  async function savePreference(value: Appearance) {
    const previous = preference
    setPreference(value)
    try {
      const saved = await saveAppearance(value)
      setPreference(saved.appearance)
    } catch (caught) {
      setPreference(previous)
      throw caught
    }
  }

  return (
    <AppearanceContext.Provider value={{ preference, savePreference }}>
      {children}
    </AppearanceContext.Provider>
  )
}

/** 外觀操作只用登入者 provider 的值，不以瀏覽器快取冒充帳號資料。 */
export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext)
  if (!context) throw new Error('外觀設定必須位於登入者範圍內')
  return context
}
