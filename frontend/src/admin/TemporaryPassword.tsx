// 臨時密碼的顯示處：密碼加「複製」按鈕，長密碼不必手抄。管理頁與
// 首次設定頁共用。複製成功後按鈕文字改為「已複製」；瀏覽器不允許
// 寫入剪貼簿時顯示提示，請使用者自行選取。

import { useState } from 'react'

// 以密碼當 key：換成新的一組密碼時重新掛載，複製狀態自然歸零，
// 不會把上一組的「已複製」沿用到新密碼。
export default function TemporaryPassword({ password }: { password: string }) {
  return <CopyablePassword key={password} password={password} />
}

function CopyablePassword({ password }: { password: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copy() {
    try {
      await navigator.clipboard.writeText(password)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <>
      <output aria-label="臨時密碼">{password}</output>
      <button onClick={() => void copy()} type="button">
        {state === 'copied' ? '已複製' : '複製'}
      </button>
      {state === 'failed' && (
        <p role="alert">無法複製，請自行選取臨時密碼。</p>
      )}
    </>
  )
}
