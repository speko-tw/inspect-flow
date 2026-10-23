import { useRef, useState } from 'react'

import { APPEARANCE_LABELS } from '../terms'
import type { Appearance } from './appearance'
import { useAppearance } from './AppearanceProvider'

/** UDS-AC08：選擇即預覽，失敗回復；與密碼表單分開避免誤送密碼。 */
export default function AppearanceSettings() {
  const { preference, savePreference } = useAppearance()
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function choose(value: Appearance) {
    if (inFlight.current || value === preference) return
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

  return (
    <section aria-labelledby="appearance-heading">
      <h2 id="appearance-heading">外觀</h2>
      <fieldset disabled={busy}>
        <legend>選擇外觀</legend>
        {(['system', 'light', 'dark'] as const).map((value) => (
          <label key={value}>
            <input
              type="radio"
              name="appearance"
              value={value}
              checked={preference === value}
              onChange={() => void choose(value)}
            />
            {APPEARANCE_LABELS[value]}
          </label>
        ))}
      </fieldset>
      <p>設定會隨帳號保存，換裝置登入也會沿用。</p>
      {busy && <p role="status">正在儲存外觀…</p>}
      {saved && <p role="status">外觀已儲存。</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
