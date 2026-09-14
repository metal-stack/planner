import { currentCatalogId } from './catalog'
import type { Plan } from './plan'

/** Maps legacy catalog ids in a plan (from older exports or localStorage)
 *  to their current replacements. Applied at every import boundary. */
export function normalizePlan(plan: Plan): Plan {
  return {
    ...plan,
    partitions: plan.partitions.map((partition) => ({
      ...partition,
      fabric: {
        ...partition.fabric,
        spineModelId: currentCatalogId(partition.fabric.spineModelId),
        superspineModelId: currentCatalogId(partition.fabric.superspineModelId),
        exitModelId: currentCatalogId(partition.fabric.exitModelId),
        storageLeafModelId: currentCatalogId(partition.fabric.storageLeafModelId),
        mgmt: {
          ...partition.fabric.mgmt,
          spineModelId: currentCatalogId(partition.fabric.mgmt.spineModelId),
          leafModelId: currentCatalogId(partition.fabric.mgmt.leafModelId),
          serverModelId: currentCatalogId(partition.fabric.mgmt.serverModelId),
        },
      },
      racks: partition.racks.map((rack) => ({
        ...rack,
        leafModelId: currentCatalogId(rack.leafModelId),
        servers: rack.servers.map((group) => ({
          ...group,
          modelId: currentCatalogId(group.modelId),
        })),
      })),
    })),
  }
}
