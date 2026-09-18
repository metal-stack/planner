import { formatBandwidth, formatRatio, rackBandwidth } from '../../derive/bandwidth'
import { deriveBom } from '../../derive/bom'
import { formatTally, planNodes } from '../../derive/nodes'
import { deriveRackLayout, formatPower, physicalRackCount } from '../../derive/rackLayout'
import { deriveTopology, filterTopology } from '../../derive/topology'
import type { Issue } from '../../derive/validate'
import type { Plan } from '../../model/plan'
import { formatMoney, lineTotal } from '../../io/priceBook'
import { usePlanStore } from '../../store/planStore'
import { usePriceStore } from '../../store/priceStore'
import HoverHint from '../HoverHint'
import Diagram from '../topology/Diagram'
import IssuesPanel from './IssuesPanel'
import { ACTION_ICON, Icon, STAT_ICON, TAB_ICON, type LucideIcon } from '../icons'

// Live summary next to the plan editor: everything here is derived from
// the plan and updates as the user types, so the consequences of an edit
// are visible without switching tabs.

function Stat({
  value,
  label,
  icon,
  hint,
  wide,
}: {
  value: number | string
  label: string
  icon: LucideIcon
  /** Optional explanation shown when the value is hovered. */
  hint?: string
  wide?: boolean
}) {
  return (
    <div className={`relative rounded bg-gray-50 px-3 py-2 ${wide ? 'col-span-2' : ''}`}>
      <Icon icon={icon} className="absolute top-2 right-2 h-3.5 w-3.5 text-gray-400" />
      <div className="text-lg font-semibold tabular-nums">
        {hint ? <HoverHint hint={hint}>{value}</HoverHint> : value}
      </div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  )
}

/** Height units, power draw and server bandwidth of the whole plan, plus
 *  the worst rack oversubscription. */
function planTotals(plan: Plan) {
  const layout = deriveRackLayout(plan)
  const racks = layout.flatMap((p) => p.racks)
  let worstRatio: number | null = null
  let serverGbps = 0
  for (const partition of plan.partitions) {
    for (const rack of partition.racks) {
      const b = rackBandwidth(rack, partition)
      serverGbps += b.downGbps
      if (b.ratio !== null && (worstRatio === null || b.ratio > worstRatio)) worstRatio = b.ratio
    }
  }
  return {
    usedU: racks.reduce((u, r) => u + r.usedU, 0),
    totalU: racks.reduce((u, r) => u + r.heightUnits, 0),
    powerWatts: racks.reduce((w, r) => w + r.powerWatts, 0),
    maxPowerWatts: racks.reduce((w, r) => w + r.maxPowerWatts, 0),
    serverGbps,
    worstRatio,
  }
}

function sumCategory(plan: Plan, category: string): number {
  return deriveBom(plan)
    .filter((l) => l.category === category)
    .reduce((n, l) => n + l.quantity, 0)
}

export default function SidePanel({ plan, issues }: { plan: Plan; issues: Issue[] }) {
  const setActiveView = usePlanStore((s) => s.setActiveView)
  const prices = usePriceStore((s) => s.prices)
  const currency = usePriceStore((s) => s.currency)
  const nodes = planNodes(plan)
  const partitions = plan.partitions.length
  const totals = planTotals(plan)
  const bom = deriveBom(plan)
  const priced = Object.keys(prices).length > 0
  const cost = priced
    ? bom.reduce((sum, l) => sum + (lineTotal({ currency, prices }, l) ?? 0), 0)
    : 0
  const complete = bom.every((l) => lineTotal({ currency, prices }, l) !== undefined)
  // Physical racks, central racks included (a rack group counts as three).
  const racks = plan.partitions.reduce((n, p) => n + physicalRackCount(p), 0)
  const graph = filterTopology(deriveTopology(plan), 'production')
  const hasTopology = graph.partitions.some(
    (p) => p.racks.length > 0 || p.central.spines.length > 0,
  )

  return (
    <div className="space-y-4">
      <section className="card p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Setup</h3>
          <span className="text-xs text-gray-500">{formatTally(nodes)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat value={nodes.total} label="server nodes" icon={STAT_ICON.nodes} />
          <Stat
            value={partitions}
            label={partitions === 1 ? 'partition' : 'partitions'}
            icon={STAT_ICON.partitions}
          />
          <Stat value={racks} label={racks === 1 ? 'rack' : 'racks'} icon={STAT_ICON.racks} />
          <Stat
            value={`${totals.usedU} U`}
            label={`of ${totals.totalU} U`}
            icon={STAT_ICON.rackUnits}
            hint={`${totals.usedU} of ${totals.totalU} height units used across ${racks} racks, central racks included.`}
          />
          <Stat value={sumCategory(plan, 'switch')} label="switches" icon={STAT_ICON.switches} />
          <Stat
            value={sumCategory(plan, 'server')}
            label="server chassis"
            icon={STAT_ICON.chassis}
          />
          <Stat
            value={`~${formatPower(totals.powerWatts)}`}
            label="estimated power"
            icon={STAT_ICON.power}
            hint={`Sum of the per-device estimates in the catalog, against ${formatPower(totals.maxPowerWatts)} of rack budgets.`}
          />
          <Stat
            value={formatBandwidth(totals.serverGbps)}
            label="server bandwidth"
            icon={STAT_ICON.bandwidth}
            hint={
              totals.worstRatio === null
                ? 'Bandwidth of all server ports, both links per node active.'
                : `Bandwidth of all server ports, both links per node active. Worst rack oversubscription ${formatRatio(totals.worstRatio)}.`
            }
          />
          {priced && (
            <Stat
              value={`${complete ? '' : '≥ '}${formatMoney(cost, currency)}`}
              label="hardware cost"
              icon={STAT_ICON.cost}
              wide
              hint={
                complete
                  ? 'Every BOM line has a unit price in the price book.'
                  : 'Only the BOM lines that have a unit price in the price book are counted.'
              }
            />
          )}
        </div>
      </section>

      <IssuesPanel issues={issues} />

      {/* Only useful as a thumbnail beside the editor; stacked below it on
          narrow screens it would fill the width, so the tab is used instead. */}
      <section className="hidden card xl:block">
        <header className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
          <h3 className="text-sm font-semibold">Topology</h3>
          <button
            type="button"
            onClick={() => setActiveView('topology')}
            className="flex items-center gap-1 text-xs font-medium text-brand-strong hover:underline"
          >
            Open
            <Icon icon={ACTION_ICON.open} className="h-3.5 w-3.5" />
          </button>
        </header>
        {hasTopology ? (
          <button
            type="button"
            onClick={() => setActiveView('topology')}
            className="block w-full cursor-zoom-in p-2"
            title="Open the topology view"
          >
            <Diagram graph={graph} fit />
          </button>
        ) : (
          <p className="px-4 py-3 text-sm text-gray-500">Add spines and racks to see the fabric.</p>
        )}
      </section>

      <div className="flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => setActiveView('racks')}
          className="btn-secondary flex-1 justify-center"
        >
          <Icon icon={TAB_ICON.racks} className="h-3.5 w-3.5" />
          Rack elevations
        </button>
        <button
          type="button"
          onClick={() => setActiveView('bom')}
          className="btn-secondary flex-1 justify-center"
        >
          <Icon icon={TAB_ICON.bom} className="h-3.5 w-3.5" />
          BOM ({deriveBom(plan).length} lines)
        </button>
      </div>
    </div>
  )
}
