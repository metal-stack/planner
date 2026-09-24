// Per-node configuration resolution. A server group carries one shared
// configuration (sizeId, compute, nicModelId, gpu); the node positions of
// a chassis may override it wholesale via ServerGroup.nodeConfigs, and an
// override applies to that position in every chassis of the group (nodes
// fill chassis in order, so chassis are configured alike). Derivation code
// works on buckets: the distinct configurations in a group with the number
// of nodes using each, so the BOM, power estimate and validation stay
// per-configuration instead of per-node.

import { catalog } from './catalog'
import type { NodeConfig, ServerGroup } from './plan'

/** The group's shared configuration in NodeConfig shape. */
export function groupConfig(group: ServerGroup): NodeConfig {
  return {
    sizeId: group.sizeId,
    ...(group.compute && { compute: group.compute }),
    ...(group.nicModelId && { nicModelId: group.nicModelId }),
    ...(group.gpu && { gpu: group.gpu }),
  }
}

/** The configuration chassis position `position` actually uses. */
export function nodeConfig(group: ServerGroup, position: number): NodeConfig {
  return group.nodeConfigs[position] ?? groupConfig(group)
}

/** Chassis positions a group's nodes occupy: min(nodesPerChassis, count). */
export function chassisPositions(group: ServerGroup): number {
  return Math.min(catalog[group.modelId]?.nodesPerChassis ?? 1, group.count)
}

/** Nodes of the group sitting at chassis position `position`: one per
 *  chassis that is filled up to it (nodes fill chassis in order). */
export function nodesAtPosition(group: ServerGroup, position: number): number {
  const nodesPer = catalog[group.modelId]?.nodesPerChassis ?? 1
  if (position >= nodesPer) return 0
  return Math.max(0, Math.ceil((group.count - position) / nodesPer))
}

export interface ConfigBucket {
  config: NodeConfig
  /** Chassis positions using this configuration, ascending. */
  positions: number[]
  /** Nodes across all chassis of the group using this configuration. */
  count: number
  /** Whether this is a per-position deviation from the group's configuration. */
  custom: boolean
}

/** The distinct configurations of a group with the nodes using each: the
 *  shared configuration first (when any position still uses it), then the
 *  deviating ones in position order. Identical deviations share a bucket. */
export function configBuckets(group: ServerGroup): ConfigBucket[] {
  const shared: ConfigBucket = {
    config: groupConfig(group),
    positions: [],
    count: 0,
    custom: false,
  }
  const sharedKey = JSON.stringify(shared.config)
  const buckets = new Map<string, ConfigBucket>([[sharedKey, shared]])
  for (let position = 0; position < chassisPositions(group); position++) {
    const config = group.nodeConfigs[position]
    const key = config ? JSON.stringify(config) : sharedKey
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { config: config!, positions: [], count: 0, custom: true }
      buckets.set(key, bucket)
    }
    bucket.positions.push(position)
    bucket.count += nodesAtPosition(group, position)
  }
  return [...buckets.values()].filter((b) => b.count > 0)
}

/** "chassis position 3" (1-based), for validation messages and BOM
 *  reasons. */
export function positionListLabel(positions: number[]): string {
  const list = positions.map((i) => i + 1).join(', ')
  return `chassis position${positions.length === 1 ? '' : 's'} ${list}`
}
