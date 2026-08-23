import { useState } from 'react'
import { IconChevronDownOutline14, Menu } from '@ryanyujazz/dsh-client-ui-primitives'
import css from './ImageGenerationSettingsCard.module.css'

export interface SelectOption { id: string; label: string }

export function SelectMenu({ value, options, label, disabled, onChange }: { value: string; options: readonly SelectOption[]; label: string; disabled?: boolean; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const selected = options.find(option => option.id === value)?.label ?? value
  return (
    <Menu
      open={open}
      items={options}
      selectedId={value}
      onSelect={id => { setOpen(false); onChange(id) }}
      onClose={() => { setOpen(false) }}
      portal
      anchor={<button type="button" className={css.selector} aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled || options.length === 0} onClick={() => { setOpen(value => !value) }}><span>{selected}</span><IconChevronDownOutline14 /></button>}
    />
  )
}
