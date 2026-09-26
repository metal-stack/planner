import type { Partition, Rack } from '../model/plan'

// Pods of a leaf-spine-superspine partition, as RFC 7938 section 3.2.3
// builds a 5-stage Clos: a pod's leaves uplink only to that pod's spines
// (Tier 2), and spine j of every pod uplinks to plane j of the superspines
// (Tier 1): "Every Tier 2 device connects to a single group of Tier 1
// devices". The central rack is the border pod: exits, storage leaves and
// a control-plane rack of its own hang off its spines (`fabric.spineCount`
// of them, like every pod), as the dedicated cluster for external
// connectivity of RFC 7938 section 5.2.4. With fabricType leaf-spine there
// are no pods: every rack uplinks to the central rack's spines.

export interface PodRacks {
  id: string
  name: string
  racks: Rack[]
}

/** Stands in for the pod list of a superspine partition that has none. */
export const IMPLICIT_POD = { id: 'pod-1', name: 'Pod 1' } as const

export function hasSuperspineTier(partition: Partition): boolean {
  return partition.fabric.fabricType === 'leaf-spine-superspine'
}

/** The compute pods with their racks: racks whose podId names no pod go to
 *  the first. Empty for a leaf-spine partition. */
export function podsOf(partition: Partition): PodRacks[] {
  if (!hasSuperspineTier(partition)) return []
  const pods = partition.pods.length > 0 ? partition.pods : [IMPLICIT_POD]
  const known = new Set(pods.map((p) => p.id))
  return pods.map((pod, i) => ({
    id: pod.id,
    name: pod.name,
    racks: partition.racks.filter((r) =>
      r.podId && known.has(r.podId) ? r.podId === pod.id : i === 0,
    ),
  }))
}

/** Every spine of the partition: the border pod's plus spineCount per
 *  compute pod with superspines, else just the central rack's. */
export function spinesTotal(partition: Partition): number {
  return partition.fabric.spineCount * (1 + podsOf(partition).length)
}

/** Superspines each plane holds: every pod's spine j connects to all of
 *  plane j. A superspine count that does not divide by the spine count
 *  leaves the remainder unconnected (validation reports it). */
export function superspinesPerPlane(partition: Partition): number {
  const { spineCount, superspineCount } = partition.fabric
  if (!hasSuperspineTier(partition) || spineCount === 0) return 0
  return Math.floor(superspineCount / spineCount)
}
