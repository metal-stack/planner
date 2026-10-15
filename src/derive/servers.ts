import { catalog } from '../model/catalog'
import type { ServerGroup } from '../model/plan'

/** Server chassis needed for a group: nodes divided by nodes-per-chassis.
 * Shared by the equipment layout and BOM without coupling their derivations. */
export function chassisCount(group: ServerGroup): number {
  const nodesPerChassis = catalog[group.modelId]?.nodesPerChassis ?? 1
  return Math.ceil(group.count / nodesPerChassis)
}
