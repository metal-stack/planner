import { catalog } from '../model/catalog'
import type { ControlPlane, Partition, Plan } from '../model/plan'

// Where the control plane's hardware lands, derived from Plan.controlPlane.
// This is the single source of the placement rules: the BOM, the rack
// elevations, the topology graph and validation all ask here instead of
// re-reading `hosting` and `placement` themselves.
//
// A KaaS control plane has no hardware at all, so every function below
// reports "nothing" for it. On-prem nodes either join the host partition's
// central rack, attaching to its exit switches, or sit in a control-plane
// rack of their own behind a leaf pair that uplinks to the spines like any
// compute rack's leaves.

/** The partition whose site hosts the on-prem nodes: the configured one,
 *  or the first in the plan when unset or gone. Undefined for KaaS and for
 *  a plan without partitions. */
export function controlPlaneHost(plan: Plan): Partition | undefined {
  if (plan.controlPlane.hosting !== 'on-prem') return undefined
  const byId = plan.partitions.find((p) => p.id === plan.controlPlane.partitionId)
  return byId ?? plan.partitions[0]
}

/** Is the control plane hardware this plan has to order? */
export function hasOnPremControlPlane(plan: Plan): boolean {
  return plan.controlPlane.hosting === 'on-prem' && plan.controlPlane.nodeCount > 0
}

/** Does the on-prem control plane live in this partition's central rack? */
export function inCentralRack(plan: Plan, partition: Partition): boolean {
  const cp = plan.controlPlane
  return (
    hasOnPremControlPlane(plan) &&
    cp.placement === 'central-rack' &&
    controlPlaneHost(plan)?.id === partition.id
  )
}

/** Does this partition hold the separate control-plane rack? */
export function hasOwnRack(plan: Plan, partition: Partition): boolean {
  const cp = plan.controlPlane
  return (
    hasOnPremControlPlane(plan) &&
    cp.placement === 'own-rack' &&
    controlPlaneHost(plan)?.id === partition.id
  )
}

/** Leaves of the control-plane rack in this partition, 0 when it has none.
 *  They terminate spine uplinks exactly like a compute rack's leaves, so
 *  every spine-side count has to include them. */
export function controlPlaneLeafCount(plan: Plan, partition: Partition): number {
  return hasOwnRack(plan, partition) ? plan.controlPlane.rack.leafCount : 0
}

/** Ports the control-plane nodes take on the switch they attach to: two
 *  100G ports per node at 2x100G, one 100G port per started group of four
 *  25G ports at 2x25G (4x25G breakout, as for server uplinks). */
export function controlPlaneSwitchPorts(cp: ControlPlane): number {
  const ports = 2 * cp.nodeCount
  return cp.uplink === '2x100G' ? ports : Math.ceil(ports / 4)
}

/** Height units and power the nodes add to the rack they sit in. */
export function controlPlaneFootprint(cp: ControlPlane): { units: number; watts: number } {
  const item = catalog[cp.nodeModelId]
  return {
    units: cp.nodeCount * (item?.heightUnits ?? 1),
    watts: cp.nodeCount * (item?.powerWatts ?? 0),
  }
}
