import type { FabricConfig, Plan, Rack } from '../../model/plan'
import {
  CONTROL_PLANE_RACK_ID,
  type TopoNode,
  type TopologyGraph,
  type TopologyMode,
} from '../../derive/topology'

// The topology builder: a palette whose items add to the plan at the
// current selection. Every item becomes a plain store action, so the
// topology, the BOM and validation stay derived from the Plan; this module
// only decides where an item lands and what gets selected afterwards. The
// selection is view state and never part of the Plan.

/** What the builder has selected: a partition (its central rack), a rack
 *  within it, or a plan-level section. */
export interface Selection {
  partitionId?: string
  rackId?: string
  section?: 'control-plane' | 'networks'
}

export type PaletteItemId =
  | 'partition'
  | 'rack'
  | 'rack-group'
  | 'server-group'
  | 'spine'
  | 'exit'
  | 'router'
  | 'external-network'

export const PALETTE: { id: PaletteItemId; label: string }[] = [
  { id: 'partition', label: 'Partition' },
  { id: 'rack', label: 'Rack' },
  { id: 'rack-group', label: 'Rack group' },
  { id: 'server-group', label: 'Server group' },
  { id: 'spine', label: 'Spine' },
  { id: 'exit', label: 'Exit' },
  { id: 'router', label: 'Router' },
  { id: 'external-network', label: 'External network' },
]

export type PlanAction =
  | { type: 'addPartition' }
  | { type: 'addRack'; partitionId: string; kind: Rack['kind'] }
  | { type: 'addServerGroup'; partitionId: string; rackId: string }
  | { type: 'patchFabric'; partitionId: string; patch: Partial<FabricConfig> }
  | { type: 'addExternalNetwork' }

/** The selection as far as it still exists in `plan`: undo, "Remove rack"
 *  or a removed partition can delete what was selected. */
export function resolveSelection(plan: Plan, sel: Selection | undefined): Selection | undefined {
  if (!sel) return undefined
  if (sel.section) return { section: sel.section }
  if (sel.rackId === CONTROL_PLANE_RACK_ID) return { section: 'control-plane' }
  const partition = plan.partitions.find((p) => p.id === sel.partitionId)
  if (!partition) return undefined
  const rack = partition.racks.find((r) => r.id === sel.rackId)
  return rack ? { partitionId: partition.id, rackId: rack.id } : { partitionId: partition.id }
}

function landing(plan: Plan, sel: Selection | undefined) {
  const resolved = resolveSelection(plan, sel)
  const partition =
    plan.partitions.find((p) => p.id === resolved?.partitionId) ?? plan.partitions[0]
  const rack = partition?.racks.find((r) => r.id === resolved?.rackId)
  return { partition, rack }
}

const TIER_COUNT: Partial<Record<PaletteItemId, 'spineCount' | 'exitSwitchCount' | 'routerCount'>> =
  {
    spine: 'spineCount',
    exit: 'exitSwitchCount',
    router: 'routerCount',
  }

/** Whether an item can be added right now, and where it would land. */
export function paletteState(
  id: PaletteItemId,
  plan: Plan,
  sel: Selection | undefined,
): { enabled: boolean; hint: string } {
  if (id === 'partition') return { enabled: true, hint: 'Adds a partition to the plan' }
  if (id === 'external-network') return { enabled: true, hint: 'Adds a plan-wide network' }
  const { partition, rack } = landing(plan, sel)
  if (!partition) return { enabled: false, hint: 'Add a partition first' }
  if (id === 'server-group') {
    return rack
      ? { enabled: true, hint: `Adds to ${rack.name}` }
      : { enabled: false, hint: 'Select a rack first' }
  }
  return { enabled: true, hint: `Adds to ${partition.name}` }
}

/** The store action an item stands for, or nothing when it is disabled. */
export function paletteAction(
  id: PaletteItemId,
  plan: Plan,
  sel: Selection | undefined,
): PlanAction | undefined {
  if (!paletteState(id, plan, sel).enabled) return undefined
  if (id === 'partition') return { type: 'addPartition' }
  if (id === 'external-network') return { type: 'addExternalNetwork' }
  const { partition, rack } = landing(plan, sel)
  if (id === 'server-group') {
    return { type: 'addServerGroup', partitionId: partition.id, rackId: rack!.id }
  }
  if (id === 'rack' || id === 'rack-group') {
    return {
      type: 'addRack',
      partitionId: partition.id,
      kind: id === 'rack' ? 'single' : 'rack-group',
    }
  }
  const field = TIER_COUNT[id]!
  return {
    type: 'patchFabric',
    partitionId: partition.id,
    patch: { [field]: partition.fabric[field] + 1 },
  }
}

/** What to select once `action` turned `before` into `after`: the rack or
 *  partition it created, or the place it changed. */
export function selectionAfter(action: PlanAction, before: Plan, after: Plan): Selection {
  switch (action.type) {
    case 'addPartition': {
      const known = new Set(before.partitions.map((p) => p.id))
      const created = after.partitions.find((p) => !known.has(p.id))
      return created ? { partitionId: created.id } : {}
    }
    case 'addRack': {
      const known = new Set(
        before.partitions.find((p) => p.id === action.partitionId)?.racks.map((r) => r.id),
      )
      const created = after.partitions
        .find((p) => p.id === action.partitionId)
        ?.racks.find((r) => !known.has(r.id))
      return created
        ? { partitionId: action.partitionId, rackId: created.id }
        : { partitionId: action.partitionId }
    }
    case 'addServerGroup':
      return { partitionId: action.partitionId, rackId: action.rackId }
    case 'patchFabric':
      return { partitionId: action.partitionId }
    case 'addExternalNetwork':
      return { section: 'networks' }
  }
}

/** A view mode in which a freshly added item is visible: compute racks and
 *  server groups are not drawn in central mode, production gear and
 *  external networks not in management mode. */
export function modeShowing(id: PaletteItemId, mode: TopologyMode): TopologyMode {
  const hiddenInCentral = id === 'rack' || id === 'rack-group' || id === 'server-group'
  const hiddenInManagement =
    id === 'spine' || id === 'exit' || id === 'router' || id === 'external-network'
  if (mode === 'central' && hiddenInCentral) return 'production'
  if (mode === 'management' && hiddenInManagement) return 'production'
  return mode
}

/** What clicking each node selects: central-rack gear its partition, rack
 *  gear its rack (a rack group's entity, from any of its three physical
 *  racks), external networks and the control plane their plan-level
 *  section. */
export function nodeSelections(graph: TopologyGraph): Map<string, Selection> {
  const out = new Map<string, Selection>()
  const put = (nodes: TopoNode[], sel: Selection) => nodes.forEach((n) => out.set(n.id, sel))
  for (const p of graph.partitions) {
    const partition = { partitionId: p.id }
    const { central } = p
    put(
      [
        ...central.routers,
        ...central.superspines,
        ...central.spines,
        ...central.exits,
        ...central.mgmtSpines,
        ...central.mgmtServers,
        ...central.mgmtFirewalls,
        ...p.storageLeaves,
      ],
      partition,
    )
    put(p.externalNetworks, { section: 'networks' })
    if (p.controlPlane) put([p.controlPlane.node], { section: 'control-plane' })
    for (const rack of p.racks) {
      put([...rack.leaves, ...rack.mgmtLeaves, ...rack.serverGroups], {
        partitionId: p.id,
        rackId: rack.entity?.id ?? rack.id,
      })
    }
  }
  return out
}
