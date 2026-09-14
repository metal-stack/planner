import type { Info } from './docs'
import { ACTION_ICON, Icon } from '../icons'

/** Small "i" bubble that reveals a short explanation on hover or focus,
 *  optionally with a link into the metal-stack documentation. */
export default function InfoBubble({ info, label }: { info: Info; label: string }) {
  return (
    <span className="group relative inline-block align-middle">
      <button
        type="button"
        aria-label={`About ${label}`}
        className="ml-1 inline-flex items-center justify-center rounded-full text-gray-400 hover:text-brand-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
      >
        <Icon icon={ACTION_ICON.info} className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full left-1/2 z-30 mt-1.5 hidden w-72 -translate-x-1/2 rounded-md border border-gray-200 bg-white p-3 text-left text-xs leading-relaxed font-normal text-gray-700 shadow-lg group-focus-within:block group-hover:block group-hover:pointer-events-auto group-focus-within:pointer-events-auto"
      >
        {info.text}
        {info.href && (
          <>
            {' '}
            <a
              href={info.href}
              target="_blank"
              rel="noreferrer"
              className="font-medium whitespace-nowrap text-brand-strong hover:underline"
            >
              {info.linkLabel ?? 'Read more'}
              <Icon icon={ACTION_ICON.external} className="ml-0.5 inline h-3 w-3 align-[-1px]" />
            </a>
          </>
        )}
      </span>
    </span>
  )
}
