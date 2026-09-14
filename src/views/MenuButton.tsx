import { useEffect, useRef, useState } from 'react'
import { ACTION_ICON, Icon, type LucideIcon } from './icons'

export interface MenuItem {
  id: string
  name: string
  description: string
}

/** Button with a dropdown of described items (templates, presets). Closes
 *  on selection, outside click and Escape. */
export default function MenuButton({
  label,
  icon,
  items,
  onSelect,
}: {
  label: string
  icon?: LucideIcon
  items: MenuItem[]
  onSelect: (item: MenuItem) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="btn-secondary"
      >
        {icon && <Icon icon={icon} />}
        {label}
        <Icon icon={ACTION_ICON.menu} className="h-3.5 w-3.5 opacity-60" />
      </button>
      {open && (
        <div
          role="menu"
          className="card absolute right-0 z-30 mt-1 w-80 overflow-hidden py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onSelect(item)
              }}
              className="block w-full px-3 py-2 text-left hover:bg-brand-tint"
            >
              <span className="block text-sm font-medium">{item.name}</span>
              <span className="block text-xs text-gray-500">{item.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
