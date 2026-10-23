import { useLayoutEffect, useRef, useState } from 'react'

import { FormGroup } from '../components'
import { APPEARANCE_LABELS } from '../terms'
import type { Appearance } from './appearance'
import { useAppearance } from './AppearanceProvider'
import './AppearanceSettings.css'

/** UDS-AC08：選擇即預覽，失敗回復；與密碼表單分開避免誤送密碼。 */
export default function AppearanceSettings() {
  const { preference, savePreference } = useAppearance()
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const options = useRef<HTMLDivElement>(null)
  const selectedRadio = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useLayoutEffect(() => {
    // 保存失敗回復時，也把群組內的鍵盤焦點移回目前選項。
    if (options.current?.contains(document.activeElement)) {
      selectedRadio.current?.focus()
    }
  }, [preference])

  async function choose(value: Appearance) {
    // 保存中忽略再次選擇；不 disabled 原生控制，避免鍵盤焦點消失。
    if (inFlight.current) {
      selectedRadio.current?.focus()
      return
    }
    if (value === preference) return
    inFlight.current = true
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await savePreference(value)
      setSaved(true)
    } catch {
      setError('外觀儲存失敗，已回復原設定。請再試一次。')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const feedback = busy
    ? '正在儲存外觀…'
    : error || (saved ? '外觀已儲存。' : '')

  return (
    <FormGroup
      title="外觀"
      description="設定會隨帳號保存，換裝置登入也會沿用。"
    >
      <div
        aria-label="選擇外觀"
        aria-busy={busy}
        className="appearance-options"
        ref={options}
        role="radiogroup"
      >
        {(['system', 'light', 'dark'] as const).map((value) => (
          <label key={value}>
            <input
              type="radio"
              name="appearance"
              value={value}
              checked={preference === value}
              ref={preference === value ? selectedRadio : undefined}
              onChange={() => void choose(value)}
            />
            {APPEARANCE_LABELS[value]}
          </label>
        ))}
      </div>
      <p
        aria-live="polite"
        aria-atomic="true"
        className="appearance-feedback"
        data-error={Boolean(error)}
      >
        {feedback}
      </p>
    </FormGroup>
  )
}
