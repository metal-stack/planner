import type { ReactNode } from 'react'

/** Wraps a value so that hovering or focusing it reveals a short hint
 *  (e.g. the formula a number came from). The value gets a dotted
 *  underline to signal that there is more to see. Set `interactive` when
 *  the child is a button or link: it keeps its own focus and styling, and
 *  the hint still appears on hover and focus. */
export default function HoverHint({
  hint,
  interactive = false,
  children,
}: {
  hint: string
  interactive?: boolean
  children: ReactNode
}) {
  return (
    <span className="group relative inline-flex">
      {interactive ? (
        children
      ) : (
        <span
          tabIndex={0}
          aria-label={hint}
          className="cursor-help underline decoration-gray-300 decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {children}
        </span>
      )}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-30 mb-1.5 hidden w-max max-w-72 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-normal whitespace-normal text-gray-700 shadow-lg group-focus-within:block group-hover:block"
      >
        {hint}
      </span>
    </span>
  )
}
