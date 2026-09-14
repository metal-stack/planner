import { useEffect, useMemo } from 'react'
import { countIssues, validatePlan } from './derive/validate'
import { useHistory, usePlanStore, type View } from './store/planStore'
import BomView from './views/BomView'
import IpView from './views/IpView'
import PlanView from './views/PlanView'
import RackLayoutView from './views/RackLayoutView'
import Toaster from './views/Toaster'
import TopologyView from './views/TopologyView'
// Official metal-stack picture mark (docs repo, docs/src/assets/logo.svg).
// Bundled locally: the app makes no network requests.
import logoUrl from './assets/metal-stack-logo.svg'
import { ACTION_ICON, Icon, TAB_ICON } from './views/icons'

const tabs: { view: View; label: string }[] = [
  { view: 'plan', label: 'Plan' },
  { view: 'topology', label: 'Topology' },
  { view: 'racks', label: 'Racks' },
  { view: 'ips', label: 'IPs' },
  { view: 'bom', label: 'BOM' },
]

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl'

export default function App() {
  const activeView = usePlanStore((s) => s.activeView)
  const setActiveView = usePlanStore((s) => s.setActiveView)
  const plan = usePlanStore((s) => s.plan)
  const { canUndo, canRedo, undo, redo } = useHistory()
  // Error badges per tab: IP issues belong to the IPs tab, the rest to Plan.
  const errorsByView = useMemo(() => {
    const issues = validatePlan(plan)
    return {
      plan: countIssues(issues.filter((i) => i.target.section !== 'ips')).errors,
      ips: countIssues(issues.filter((i) => i.target.section === 'ips')).errors,
    } as Partial<Record<View, number>>
  }, [plan])

  // Global undo/redo shortcuts. Inputs are controlled by the store, so the
  // store history is the single source of truth and the browser's own text
  // undo is suppressed.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (key === 'y' && !isMac) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-t-[3px] border-b border-t-brand border-b-gray-200 bg-white px-6 py-2.5">
        <div className="flex items-center gap-8">
          <a
            href="https://metal-stack.io"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2.5"
            title="metal-stack.io"
          >
            <img src={logoUrl} alt="" width={28} height={28} className="h-7 w-7" />
            <span className="text-base font-bold tracking-tight">
              metal-stack
              <span className="ml-1.5 font-medium text-gray-500">planner</span>
            </span>
          </a>
          <nav className="flex gap-1">
            {tabs.map(({ view, label }) => (
              <button
                key={view}
                onClick={() => setActiveView(view)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeView === view
                    ? 'bg-ink text-white'
                    : 'text-gray-600 hover:bg-brand-tint hover:text-ink'
                }`}
              >
                <Icon icon={TAB_ICON[view]} />
                {label}
                {(errorsByView[view] ?? 0) > 0 && (
                  <span
                    title={`${errorsByView[view]} error${errorsByView[view] === 1 ? '' : 's'}`}
                    className="rounded-full bg-red-500 px-1.5 text-[10px] leading-4 font-bold text-white"
                  >
                    {errorsByView[view]}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex gap-1">
            <button
              type="button"
              onClick={() => undo()}
              disabled={!canUndo}
              title={`Undo (${mod}+Z)`}
              className="btn-secondary"
            >
              <Icon icon={ACTION_ICON.undo} />
              Undo
            </button>
            <button
              type="button"
              onClick={() => redo()}
              disabled={!canRedo}
              title={`Redo (${mod}+Shift+Z)`}
              className="btn-secondary"
            >
              <Icon icon={ACTION_ICON.redo} />
              Redo
            </button>
          </div>
        </div>
      </header>
      <main className="p-6">
        {activeView === 'plan' && <PlanView />}
        {activeView === 'topology' && <TopologyView />}
        {activeView === 'racks' && <RackLayoutView />}
        {activeView === 'ips' && <IpView />}
        {activeView === 'bom' && <BomView />}
      </main>
      <Toaster />
    </div>
  )
}
