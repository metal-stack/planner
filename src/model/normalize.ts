import { currentCatalogId } from './catalog'
import type { NodeConfig, Plan } from './plan'

/** Maps the catalog ids a node-level configuration carries (GPU, NIC, CPU,
 *  DIMM) — the shape both a server group and its per-node entries share. */
function normalizeConfig<T extends Partial<NodeConfig>>(config: T): T {
  return {
    ...config,
    ...(config.gpu && { gpu: { ...config.gpu, modelId: currentCatalogId(config.gpu.modelId) } }),
    ...(config.nicModelId && { nicModelId: currentCatalogId(config.nicModelId) }),
    ...(config.compute && {
      compute: {
        ...config.compute,
        ...(config.compute.cpuModelId && {
          cpuModelId: currentCatalogId(config.compute.cpuModelId),
        }),
        ...(config.compute.dimmModelId && {
          dimmModelId: currentCatalogId(config.compute.dimmModelId),
        }),
      },
    }),
  }
}

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
          ...normalizeConfig(group),
          modelId: currentCatalogId(group.modelId),
          nodeConfigs: Object.fromEntries(
            Object.entries(group.nodeConfigs).map(([node, config]) => [
              node,
              normalizeConfig(config),
            ]),
          ),
        })),
      })),
    })),
  }
}
