import type { Partition, Plan, Rack, ServerRole } from '../model/plan'

// Node tallies at every aggregation level: rack (or three-rack entity),
// partition, and the whole setup. "Nodes" are server nodes in compute
// racks — management servers in the central rack are infrastructure and
// not counted.

export interface NodeTally {
  total: number
  byRole: Partial<Record<ServerRole, number>>
}

export function rackNodes(rack: Rack): NodeTally {
  const byRole: NodeTally['byRole'] = {}
  let total = 0
  for (const group of rack.servers) {
    byRole[group.role] = (byRole[group.role] ?? 0) + group.count
    total += group.count
  }
  return { total, byRole }
}

function merge(a: NodeTally, b: NodeTally): NodeTally {
  const byRole: NodeTally['byRole'] = { ...a.byRole }
  for (const [role, count] of Object.entries(b.byRole) as [ServerRole, number][]) {
    byRole[role] = (byRole[role] ?? 0) + count
  }
  return { total: a.total + b.total, byRole }
}

export function partitionNodes(partition: Partition): NodeTally {
  return partition.racks.map(rackNodes).reduce(merge, { total: 0, byRole: {} })
}

export function planNodes(plan: Plan): NodeTally {
  return plan.partitions.map(partitionNodes).reduce(merge, { total: 0, byRole: {} })
}

/** "72 nodes (64 worker, 8 storage)" — roles listed only when mixed. */
export function formatTally(tally: NodeTally): string {
  const noun = tally.total === 1 ? 'node' : 'nodes'
  const roles = Object.entries(tally.byRole).filter(([, n]) => n > 0)
  if (roles.length <= 1) return `${tally.total} ${roles[0]?.[0] ?? ''} ${noun}`.replace('  ', ' ')
  const parts = roles.map(([role, n]) => `${n} ${role}`).join(', ')
  return `${tally.total} ${noun} (${parts})`
}
