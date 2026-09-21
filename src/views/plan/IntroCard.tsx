import { useUiStore } from '../../store/uiStore'
import { ACTION_ICON, Icon } from '../icons'

// What the tool is, for a first-time visitor: the same scope the README
// opens with. Dismissed once and never shown again, so the Plan tab stays
// the dense editor it is for everyone who already knows the planner.

export default function IntroCard() {
  const dismissed = useUiStore((s) => s.introDismissed)
  const dismiss = useUiStore((s) => s.dismissIntro)
  if (dismissed) return null

  return (
    <div className="card relative flex overflow-hidden">
      <div className="w-1 shrink-0 bg-brand" aria-hidden />
      <div className="max-w-3xl space-y-2 px-5 py-4">
        <p className="text-sm leading-relaxed text-gray-600">
          Plan a{' '}
          <a
            href="https://metal-stack.io"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-ink underline decoration-brand-soft underline-offset-2 hover:decoration-brand"
          >
            metal-stack
          </a>{' '}
          installation: configure the production and management networks, see the resulting
          topology, rack elevations and IP address plan, and get an orderable hardware bill of
          materials. Nothing leaves your browser; plans are saved locally and export as JSON.
        </p>
        <p className="flex items-baseline gap-2 text-sm text-gray-600">
          <span className="rounded bg-brand-tint px-1.5 py-0.5 text-xs font-semibold text-brand-strong">
            Alpha
          </span>
          <span>
            The hardware catalog and the derivation rules are still moving, so review the numbers
            before you order from them.
          </span>
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        title="Hide this"
        aria-label="Hide the introduction"
        className="absolute top-2 right-2 rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-ink"
      >
        <Icon icon={ACTION_ICON.close} />
      </button>
    </div>
  )
}
