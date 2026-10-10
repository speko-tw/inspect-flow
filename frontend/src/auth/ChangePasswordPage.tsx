// 變更密碼頁（AUT-R38）：目前密碼、新密碼、再輸入一次新密碼三個
// 欄位。兩次新密碼不同時不送出 API，只顯示不一致的訊息；送出後依
// AUT-R34 的錯誤碼分別顯示不同訊息。前端不自行檢查新密碼長度——
// 長度規則（AUT-R04）由後端的 `auth.password_invalid` 錯誤碼回
// 報，前端只負責顯示對應訊息；訊息裡的上下限數字集中成常數
// （見下方 `PASSWORD_MIN_LENGTH`、`PASSWORD_MAX_LENGTH`），
// 不在別處另外硬寫規則，避免兩處各自維護、互相不同步。
//
// 成功後導回原路徑並帶「密碼已變更。」提示（`RequireAuth` 導向這裡時放進
// `location.state.from`；沒有時導向 `/`，由 `HomeRedirect` 依身分
// 決定去管理頁或現場頁，並把提示轉給落點頁）；不必在這裡重新查詢目
// 前使用者——導回的路由用不同的 `RequireAuth` key（見 `App.tsx`），
// 會重新掛載並自行查詢，讀到的 `must_change_password` 自然是最新
// 的。
//
// 頁面也放了 `LogoutButton`：臨時密碼帳號被導到本頁後，若不想現
// 在改密碼，仍可登出（AUT-R30、AUT-R33 允許登出）。

import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { BackLink } from '../layout/BackLink'
import { ApiError, changePassword } from './api'
import AuthLayout from './AuthLayout'
import { landingLabel, landingPath } from './landing'
import LogoutButton from './LogoutButton'
import { isSafeRedirectPath } from './safeRedirect'
import { useCurrentUser } from './useCurrentUser'
import { Form, FormError, FormSubmitButton } from '../ui/Form'

// AUT-R04：新密碼長度必須介於 8～128 個字元（含兩端），以 Unicode
// code point 計算；集中成常數只為了組出下面的錯誤訊息，前端不會
// 拿這兩個數字自行檢查長度。
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 128

const PASSWORD_RULE_TEXT =
  `新密碼長度為 ${PASSWORD_MIN_LENGTH}～${PASSWORD_MAX_LENGTH} 個字元，` +
  '不限大小寫、數字或符號，也不能和目前密碼相同。'
const MISMATCH_MESSAGE = '兩次輸入的新密碼不一致，請重新輸入。'
const CURRENT_PASSWORD_INCORRECT_MESSAGE = '目前密碼錯誤，請再試一次。'
const PASSWORD_INVALID_MESSAGE =
  `新密碼長度需為 ${PASSWORD_MIN_LENGTH}～${PASSWORD_MAX_LENGTH}` +
  ' 個字元，請重新輸入。'
const PASSWORD_UNCHANGED_MESSAGE = '新密碼不能與目前密碼相同，請重新輸入。'
const PERMISSION_DENIED_MESSAGE = '此帳號無法變更密碼，請洽系統管理員。'
const GENERIC_ERROR_MESSAGE = '變更密碼失敗，請稍後再試。'
// 成功後帶到落點頁的提示（router state `notice`；工作台與管理頁
// 都會顯示）。
const SUCCESS_NOTICE = '密碼已變更。'

const ERROR_MESSAGES_BY_CODE: Record<string, string> = {
  'auth.current_password_incorrect': CURRENT_PASSWORD_INCORRECT_MESSAGE,
  'auth.password_invalid': PASSWORD_INVALID_MESSAGE,
  'auth.password_unchanged': PASSWORD_UNCHANGED_MESSAGE,
  'permission.denied': PERMISSION_DENIED_MESSAGE,
}

interface RedirectState {
  from?: unknown
}

export default function ChangePasswordPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useCurrentUser()
  const target = landingPath(user)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (newPassword !== confirmPassword) {
      setError(MISMATCH_MESSAGE)
      return
    }

    setSubmitting(true)

    try {
      await changePassword(currentPassword, newPassword)

      const state = location.state as RedirectState | null
      const from = state?.from
      navigate(isSafeRedirectPath(from) ? from : '/', {
        replace: true,
        state: { notice: SUCCESS_NOTICE },
      })
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : undefined
      setError(
        (code !== undefined ? ERROR_MESSAGES_BY_CODE[code] : undefined) ??
          GENERIC_ERROR_MESSAGE,
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      back={
        user.must_change_password ? undefined : (
          <BackLink to={target}>返回{landingLabel(target)}</BackLink>
        )
      }
      title="變更密碼"
      lead="請輸入目前密碼，並設定新的密碼。"
    >
      <Form onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="change-password-current">目前密碼</label>
          <input
            id="change-password-current"
            name="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="change-password-new">新密碼</label>
          <input
            id="change-password-new"
            name="new-password"
            type="password"
            autoComplete="new-password"
            aria-describedby="change-password-rule"
            required
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <p className="tpl-hint" id="change-password-rule">
            {PASSWORD_RULE_TEXT}
          </p>
        </div>
        <div>
          <label htmlFor="change-password-confirm">再輸入一次新密碼</label>
          <input
            id="change-password-confirm"
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </div>
        {error !== null ? <FormError>{error}</FormError> : null}
        <FormSubmitButton className="btn-primary" disabled={submitting}>
          變更密碼
        </FormSubmitButton>
      </Form>
      <LogoutButton />
    </AuthLayout>
  )
}
