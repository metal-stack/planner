import { useMemo, useState } from 'react'
import { deriveTopology, filterTopology, type TopologyMode } from '../derive/topology'
import { validatePlan, type Issue, type IssueTarget } from '../derive/validate'
import type { Plan } from '../model/plan'
import { usePlanStore } from '../store/planStore'
import {
  ACTION_ICON,
  EXTERNAL_NETWORK_ICON,
  Icon,
  NODE_ICON,
  PALETTE_ICON,
  type LucideIcon,
} from './icons'
import CentralRackSection from './plan/CentralRackSection'
import ControlPlaneSection from './plan/ControlPlaneSection'
import ExternalNetworksSection from './plan/ExternalNetworksSection'
import RackSection from './plan/RackSection'
import { navigateTo } from './plan/navigate'
import ZoomPane from './topology/ZoomPane'
import Diagram from './topology/Diagram'
import {
  PALETTE,
  modeShowing,
  paletteAction,
  paletteState,
  resolveSelection,
  selectionAfter,
  type PaletteItemId,
  type PlanAction,
  type Selection,
} from './topology/build'
import { COLOR } from './colors'

const LEGEND_DEVICES: [LucideIcon, string][] = [
  [NODE_ICON.leaf, 'Switch'],
  [NODE_ICON.router, 'Router'],
  [NODE_ICON['server-group'], 'Servers'],
  [NODE_ICON['mgmt-server'], 'Mgmt server'],
  [NODE_ICON['mgmt-firewall'], 'Mgmt firewall'],
  [EXTERNAL_NETWORK_ICON.internet, 'Internet'],
]

function LegendLine(props: { color: string; width: number; dashed?: boolean; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <svg width={28} height={8}>
        <line
          x1={0}
          y1={4}
          x2={28}
          y2={4}
          stroke={props.color}
          strokeWidth={props.width}
          strokeDasharray={props.dashed ? '5 4' : undefined}
        />
      </svg>
      {props.label}
    </span>
  )
}

const modes: { mode: TopologyMode; label: string; hint: string }[] = [
  { mode: 'production', label: 'Production', hint: 'Routers, exits, spines, leaves and servers' },
  {
    mode: 'management',
    label: 'Management',
    hint: 'Mgmt spines, mgmt servers, mgmt firewalls, mgmt leaves',
  },
  { mode: 'central', label: 'Central rack', hint: 'Only the central rack, both networks' },
]

/** Runs a builder action through the plan store, so it is undoable like
 *  any edit in the Plan tab. */
function runAction(action: PlanAction): void {
  const store = usePlanStore.getState()
  switch (action.type) {
    case 'addPartition':
      return store.addPartition()
    case 'addRack':
      return store.addRack(action.partitionId, action.kind)
    case 'addServerGroup':
      return store.addServerGroup(action.partitionId, action.rackId)
    case 'patchFabric':
      return store.patchFabric(action.partitionId, action.patch)
    case 'addExternalNetwork':
      return store.addExternalNetwork()
  }
}

function Palette({
  plan,
  selection,
  onAdd,
}: {
  plan: Plan
  selection: Selection | undefined
  onAdd: (id: PaletteItemId) => void
}) {
  return (
    <div className="card p-2" role="group" aria-label="Add to the plan">
      <p className="px-1 pb-2 text-xs text-gray-500">Click to add</p>
      <div className="flex flex-wrap gap-1 xl:flex-col">
        {PALETTE.map((item) => {
          const state = paletteState(item.id, plan, selection)
          return (
            <button
              key={item.id}
              type="button"
              disabled={!state.enabled}
              onClick={() => onAdd(item.id)}
              title={state.hint}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-brand-tint disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Icon icon={PALETTE_ICON[item.id]} className="h-4 w-4 shrink-0 text-gray-500" />
              <span className="flex flex-col">
                {item.label}
                <span className="text-xs text-gray-500">{state.hint}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Where "Open in plan editor" jumps: the networks section has no anchor
 *  of its own, so it opens the Plan tab at the top. */
function editorTarget(selection: Selection | undefined): IssueTarget {
  if (!selection || selection.section === 'networks') return {}
  if (selection.section === 'control-plane') return { section: 'control-plane' }
  return { partitionId: selection.partitionId, rackId: selection.rackId }
}

function Inspector({
  plan,
  issues,
  selection,
}: {
  plan: Plan
  issues: Issue[]
  selection: Selection | undefined
}) {
  const partition = plan.partitions.find((p) => p.id === selection?.partitionId)
  const rack = partition?.racks.find((r) => r.id === selection?.rackId)
  const body =
    selection?.section === 'networks' ? (
      <ExternalNetworksSection plan={plan} />
    ) : selection?.section === 'control-plane' ? (
      <ControlPlaneSection plan={plan} issues={issues} />
    ) : partition && rack ? (
      <RackSection partition={partition} rack={rack} issues={issues} />
    ) : partition ? (
      <CentralRackSection partition={partition} issues={issues} />
    ) : undefined

  if (!body) {
    return (
      <p className="card p-4 text-sm text-gray-600">
        Click the central rack, a rack or a device to edit it here, or add something from the
        palette.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => navigateTo(editorTarget(selection))}
          className="btn-secondary px-2 py-1 text-xs"
        >
          <Icon icon={ACTION_ICON.open} className="h-3.5 w-3.5" />
          Open in plan editor
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto">{body}</div>
    </div>
  )
}

export default function TopologyView() {
  const plan = usePlanStore((s) => s.plan)
  const [mode, setMode] = useState<TopologyMode>('production')
  const [picked, setPicked] = useState<Selection>()
  const selection = resolveSelection(plan, picked)
  const issues = useMemo(() => validatePlan(plan), [plan])
  const graph = filterTopology(deriveTopology(plan), mode)

  const hasContent = graph.partitions.some(
    (p) => p.racks.length > 0 || p.central.spines.length > 0 || p.central.exits.length > 0,
  )

  function add(id: PaletteItemId) {
    const before = usePlanStore.getState().plan
    const action = paletteAction(id, before, selection)
    if (!action) return
    runAction(action)
    setPicked(selectionAfter(action, before, usePlanStore.getState().plan))
    setMode(modeShowing(id, mode))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Topology view"
          className="inline-flex rounded-md border border-gray-300 bg-white p-0.5"
        >
          {modes.map((m) => (
            <button
              key={m.mode}
              type="button"
              onClick={() => setMode(m.mode)}
              title={m.hint}
              aria-pressed={mode === m.mode}
              className={`rounded px-3 py-1 text-sm font-medium ${
                mode === m.mode
                  ? 'bg-ink text-white'
                  : 'text-gray-600 hover:bg-brand-tint hover:text-ink'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="text-sm text-gray-600">{modes.find((m) => m.mode === mode)?.hint}</span>
      </div>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="xl:w-52 xl:shrink-0">
          <Palette plan={plan} selection={selection} onAdd={add} />
        </div>
        <div className="min-w-0 flex-1">
          {hasContent ? (
            <ZoomPane
              footer={
                <>
                  {mode !== 'management' && (
                    <LegendLine color={COLOR.production} width={2.2} label="Production 100G" />
                  )}
                  {mode !== 'production' && (
                    <>
                      <LegendLine color={COLOR.mgmtData} width={1} label="Management 1G" />
                      <LegendLine color={COLOR.mgmtPort} width={1} label="Mgmt interface (eth0)" />
                    </>
                  )}
                  {mode !== 'management' && (
                    <LegendLine color={COLOR.gray500} width={1.4} dashed label="External network" />
                  )}
                  <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
                    {LEGEND_DEVICES.map(([icon, label]) => (
                      <span key={label} className="flex items-center gap-1.5">
                        <Icon icon={icon} className="h-3.5 w-3.5 text-gray-500" />
                        {label}
                      </span>
                    ))}
                  </span>
                </>
              }
            >
              <Diagram graph={graph} onSelect={setPicked} selected={selection} />
            </ZoomPane>
          ) : (
            <p className="card p-4 text-sm text-gray-600">
              Nothing to draw yet. Add a partition, spines and racks from the palette.
            </p>
          )}
        </div>
        <div className="xl:w-md xl:shrink-0">
          <Inspector plan={plan} issues={issues} selection={selection} />
        </div>
      </div>
    </div>
  )
}
