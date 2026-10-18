import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from 'react'

import styles from './components.module.css'
import { Tag } from './Tag'

type CardBase = {
  children: ReactNode
  selected?: boolean
  className?: string
}

type StaticCardProps = CardBase &
  Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'tabIndex'> & {
    href?: never
    onClick?: never
    disabled?: never
    selected?: never
  }

type LinkCardProps = CardBase &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> & {
    href: string
    onClick?: never
    disabled?: never
  }

type ButtonCardProps = CardBase &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    href?: never
    onClick: NonNullable<ButtonHTMLAttributes<HTMLButtonElement>['onClick']>
  }

/**
 * 呈現靜態內容或原生連結／按鈕卡片。
 * @remarks 靜態版不加入焦點序列。
 */
export function Card(
  props: StaticCardProps | LinkCardProps | ButtonCardProps,
) {
  const { children, selected, className, ...rest } = props
  const isLink = typeof props.href === 'string'
  const isButton = typeof props.onClick === 'function'
  const isSelected = selected === true
  const classes = [
    styles.card,
    isLink || isButton ? styles.interactiveCard : undefined,
    isSelected ? styles.selected : undefined,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  if (isLink) {
    const linkProps = rest as Omit<LinkCardProps, keyof CardBase | 'href'>
    return (
      <a
        {...linkProps}
        aria-current={isSelected ? 'true' : undefined}
        className={classes}
        href={props.href}
      >
        {isSelected ? (
          <Tag className={styles.selectedLabel}>目前選取</Tag>
        ) : null}
        {children}
      </a>
    )
  }

  if (isButton) {
    const buttonProps = rest as Omit<
      ButtonCardProps,
      keyof CardBase | 'onClick'
    >
    return (
      <button
        {...buttonProps}
        aria-pressed={selected === undefined ? undefined : selected}
        className={classes}
        type="button"
      >
        {isSelected ? (
          <Tag className={styles.selectedLabel}>目前選取</Tag>
        ) : null}
        {children}
      </button>
    )
  }

  const staticProps = rest as Omit<StaticCardProps, keyof CardBase>
  return (
    <div {...staticProps} className={classes}>
      {children}
    </div>
  )
}
