import type { InputHTMLAttributes } from 'react'

import styles from './components.module.css'

export type InputProps = InputHTMLAttributes<HTMLInputElement>

/**
 * 提供使用語意 token 與可見焦點的原生文字輸入控制項。
 */
export function Input({ className, ...props }: InputProps) {
  return (
    <input
      {...props}
      className={[styles.input, className].filter(Boolean).join(' ')}
    />
  )
}
