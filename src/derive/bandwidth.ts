import { type Partition, type Rack, type UplinkSpeed } from '../model/plan'

// Oversubscription of the fabric: how much machine bandwidth sits behind
// the uplinks of a tier. A fabric is non-blocking at 1:1 or better.
// Like everything else downstream of the Plan this is derived, never
// stored; validate.ts turns it into issues when FabricConfig.nonBlocking
// is set, and the plan editor shows the ratio either way.
//
// Servers are dual-attached across the rack's leaf pair, so the rack-level
// ratio equals the per-leaf ratio and this module works per rack.

/** Bandwidth of one server node, both ports active (Gbit/s). */
export const UPLINK_GBPS: Record<UplinkSpeed, number> = { '2x25G': 50, '2x100G': 200 }

const FABRIC_LINK_GBPS = 100

export interface Oversubscription {
  /** Bandwidth of the machines behind the tier, Gbit/s. */
  downGbps: number
  /** Bandwidth the tier has towards the next one, Gbit/s. */
  upGbps: number
  /** down ÷ up; null when one side is zero (nothing to compare). */
  ratio: number | null
}

function oversubscription(downGbps: number, upGbps: number): Oversubscription {
  return { downGbps, upGbps, ratio: downGbps > 0 && upGbps > 0 ? downGbps / upGbps : null }
}

/** Server bandwidth of a rack against its leaf → spine bandwidth. */
export function rackBandwidth(rack: Rack, partition: Partition): Oversubscription {
  const servers = rack.servers.reduce((gbps, g) => gbps + g.count * UPLINK_GBPS[g.uplink], 0)
  const { spineCount, leafSpineLinks } = partition.fabric
  return oversubscription(servers, rack.leafCount * spineCount * leafSpineLinks * FABRIC_LINK_GBPS)
}

/** Leaf → spine bandwidth of a partition against spine → superspine, per
 *  spine. Null unless the fabric has a superspine tier. */
export function spineBandwidth(partition: Partition): Oversubscription | null {
  const { fabricType, superspineCount, leafSpineLinks } = partition.fabric
  if (fabricType !== 'leaf-spine-superspine') return null
  const leaves = partition.racks.reduce((n, r) => n + r.leafCount, 0)
  return oversubscription(
    leaves * leafSpineLinks * FABRIC_LINK_GBPS,
    superspineCount * FABRIC_LINK_GBPS,
  )
}

/** Links per leaf ↔ spine pair a non-blocking rack would need. */
export function requiredLeafSpineLinks(rack: Rack, partition: Partition): number {
  const perLink = rack.leafCount * partition.fabric.spineCount * FABRIC_LINK_GBPS
  if (perLink <= 0) return 0
  return Math.ceil(rackBandwidth(rack, partition).downGbps / perLink)
}

/** Superspines a non-blocking spine tier would need. */
export function requiredSuperspines(partition: Partition): number {
  const leaves = partition.racks.reduce((n, r) => n + r.leafCount, 0)
  return leaves * partition.fabric.leafSpineLinks
}

/** "1.0 : 1", "14.4 : 1", or "—" when there is nothing to compare. */
export function formatRatio(ratio: number | null): string {
  return ratio === null ? '–' : `${ratio.toFixed(1)} : 1`
}

/** Large totals as Tbit/s, e.g. "11.5 Tbit/s"; below 1 Tbit/s as Gbit/s. */
export function formatBandwidth(gbps: number): string {
  return gbps >= 1000 ? `${(gbps / 1000).toFixed(1)} Tbit/s` : formatGbps(gbps)
}

/** Gbit/s with thousands separators, e.g. "5,750 Gbit/s". */
export function formatGbps(gbps: number): string {
  return `${gbps.toLocaleString('en-US')} Gbit/s`
}
