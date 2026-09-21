import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ACTION_ICON, Icon } from '../icons'

// Pan/zoom container for the topology: wheel zooms about the cursor, drag
// pans, "Fit" scales the content to the pane (enlarging small diagrams up to
// MAX_FIT, so a single rack doesn't sit tiny in an empty canvas), "100 %"
// resets. An optional footer (the legend) sits inside the same card. Pure CSS
// transform on an inner element — no library, nothing persisted.

const MIN_SCALE = 0.15
const MAX_SCALE = 3
const MAX_FIT = 1.6
const PAD = 16

interface View {
  x: number
  y: number
  k: number
}

export default function ZoomPane({
  children,
  footer,
}: {
  children: ReactNode
  footer?: ReactNode
}) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: PAD, y: PAD, k: 1 })
  const [content, setContent] = useState({ w: 0, h: 0 })
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)

  function fit(w = content.w, h = content.h) {
    const el = outer.current
    if (!el || w === 0 || h === 0) return
    const k = Math.min((el.clientWidth - 2 * PAD) / w, (el.clientHeight - 2 * PAD) / h, MAX_FIT)
    setView({ k, x: (el.clientWidth - w * k) / 2, y: Math.max(PAD, (el.clientHeight - h * k) / 2) })
  }

  // Measure the content; refit whenever its size changes (plan edits).
  useEffect(() => {
    const el = inner.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.scrollWidth
      const h = el.scrollHeight
      setContent((c) => (c.w === w && c.h === h ? c : { w, h }))
      fit(w, h)
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = outer.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      setView((v) => {
        const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.k * Math.exp(-e.deltaY * 0.0015)))
        // keep the point under the cursor fixed
        const x = px - ((px - v.x) * k) / v.k
        const y = py - ((py - v.y) * k) / v.k
        return { x, y, k }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div className="card relative">
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        <button type="button" onClick={() => fit()} className="btn-secondary px-2 py-1 text-xs">
          <Icon icon={ACTION_ICON.fit} className="h-3.5 w-3.5" />
          Fit
        </button>
        <button
          type="button"
          onClick={() => setView({ x: PAD, y: PAD, k: 1 })}
          className="btn-secondary px-2 py-1 text-xs"
        >
          100 %
        </button>
        <span className="self-center pl-1 text-xs text-gray-500 tabular-nums">
          {Math.round(view.k * 100)} %
        </span>
      </div>
      <div
        ref={outer}
        className="h-[70vh] min-h-[420px] overflow-hidden select-none"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
          setDragging(true)
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) }))
        }}
        onPointerUp={() => {
          drag.current = null
          setDragging(false)
        }}
        onPointerCancel={() => {
          drag.current = null
          setDragging(false)
        }}
      >
        <div
          ref={inner}
          className="inline-block"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
            transformOrigin: '0 0',
          }}
        >
          {children}
        </div>
      </div>
      {footer && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-gray-100 px-4 py-2.5 text-xs text-gray-600">
          {footer}
        </div>
      )}
    </div>
  )
}
