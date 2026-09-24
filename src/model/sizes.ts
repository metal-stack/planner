// Node sizes mirror metalstack.cloud machine types. Each size resolves to
// orderable CPU and memory parts for the selected board socket. The planner
// deliberately models one CPU per node, including on dual-socket boards.
// Server powerWatts already represents a typical complete configuration, so
// CPU TDP and memory are not added to rack power estimates.

import { catalog, type CpuSocket } from './catalog'
import type { ServerGroup } from './plan'

export interface SizeParts {
  /** Absent on platforms with a soldered CPU (X11 MicroCloud): the size's
   *  core count comes with the board and only memory is ordered. */
  cpuModelId?: string
  dimmModelId: string
  dimmsPerNode: number
}

export interface NodeSize {
  id: string
  cores: number
  memoryGiB: number
  /** Orderable parts per board socket. A missing socket means the size is
   *  not achievable on boards with that socket (validated, not misordered). */
  parts: Partial<Record<CpuSocket, SizeParts>>
}

export const DEFAULT_SIZE_ID = 'n1-medium-x86'

export const nodeSizes: NodeSize[] = [
  {
    id: 'n1-medium-x86',
    cores: 8,
    memoryGiB: 32,
    parts: {
      AM5: { cpuModelId: 'cpu-epyc-4344p', dimmModelId: 'mem-ddr5u-16g', dimmsPerNode: 2 },
      'LGA-1700': {
        cpuModelId: 'cpu-xeon-e2488',
        dimmModelId: 'mem-ddr5u-16g',
        dimmsPerNode: 2,
      },
      'LGA-4189': {
        cpuModelId: 'cpu-xeon-4309y',
        dimmModelId: 'mem-ddr4r-16g',
        dimmsPerNode: 2,
      },
      'LGA-4677': {
        cpuModelId: 'cpu-xeon-4509y',
        dimmModelId: 'mem-ddr5r-16g',
        dimmsPerNode: 2,
      },
      'LGA-3647': {
        cpuModelId: 'cpu-xeon-4215r',
        dimmModelId: 'mem-ddr4r-16g',
        dimmsPerNode: 2,
      },
      'LGA-4710': {
        cpuModelId: 'cpu-xeon-6714p',
        dimmModelId: 'mem-ddr5r-16g',
        dimmsPerNode: 2,
      },
      'D-2100': { dimmModelId: 'mem-ddr4r-16g', dimmsPerNode: 2 },
    },
  },
  {
    id: 'c1-medium-x86',
    cores: 8,
    memoryGiB: 128,
    parts: {
      AM5: { cpuModelId: 'cpu-epyc-4344p', dimmModelId: 'mem-ddr5u-32g', dimmsPerNode: 4 },
      'LGA-1700': {
        cpuModelId: 'cpu-xeon-e2488',
        dimmModelId: 'mem-ddr5u-32g',
        dimmsPerNode: 4,
      },
      'LGA-4189': {
        cpuModelId: 'cpu-xeon-4309y',
        dimmModelId: 'mem-ddr4r-32g',
        dimmsPerNode: 4,
      },
      'LGA-4677': {
        cpuModelId: 'cpu-xeon-4509y',
        dimmModelId: 'mem-ddr5r-32g',
        dimmsPerNode: 4,
      },
      'LGA-3647': {
        cpuModelId: 'cpu-xeon-4215r',
        dimmModelId: 'mem-ddr4r-32g',
        dimmsPerNode: 4,
      },
      'LGA-4710': {
        cpuModelId: 'cpu-xeon-6714p',
        dimmModelId: 'mem-ddr5r-32g',
        dimmsPerNode: 4,
      },
      'D-2100': { dimmModelId: 'mem-ddr4r-32g', dimmsPerNode: 4 },
    },
  },
  {
    id: 'c1-large-x86',
    cores: 24,
    memoryGiB: 192,
    parts: {
      'LGA-4189': {
        cpuModelId: 'cpu-xeon-5318y',
        dimmModelId: 'mem-ddr4r-32g',
        dimmsPerNode: 6,
      },
      'LGA-4677': {
        cpuModelId: 'cpu-xeon-6442y',
        dimmModelId: 'mem-ddr5r-32g',
        dimmsPerNode: 6,
      },
      'LGA-3647': {
        cpuModelId: 'cpu-xeon-6252',
        dimmModelId: 'mem-ddr4r-32g',
        dimmsPerNode: 6,
      },
      'LGA-4710': {
        cpuModelId: 'cpu-xeon-6527p',
        dimmModelId: 'mem-ddr5r-32g',
        dimmsPerNode: 6,
      },
    },
  },
]

export function nodeSize(id: string): NodeSize | undefined {
  return nodeSizes.find((size) => size.id === id)
}

export function sizeLabel(size: NodeSize): string {
  return `${size.id} (${size.cores} cores, ${size.memoryGiB} GiB)`
}

export interface ResolvedCompute {
  size?: NodeSize
  cpuModelId?: string
  dimmModelId?: string
  dimmsPerNode?: number
  custom: boolean
}

export function resolveNodeCompute(
  group: Pick<ServerGroup, 'modelId' | 'sizeId' | 'compute'>,
): ResolvedCompute {
  const size = nodeSize(group.sizeId)
  const socket = catalog[group.modelId]?.socket
  const preset = socket ? size?.parts[socket] : undefined
  const compute = group.compute
  const cpuModelId = compute?.cpuModelId ?? preset?.cpuModelId
  const dimmModelId = compute?.dimmModelId ?? preset?.dimmModelId
  const dimmsPerNode = compute?.dimmsPerNode ?? preset?.dimmsPerNode
  const custom =
    (compute?.cpuModelId !== undefined && compute.cpuModelId !== preset?.cpuModelId) ||
    (compute?.dimmModelId !== undefined && compute.dimmModelId !== preset?.dimmModelId) ||
    (compute?.dimmsPerNode !== undefined && compute.dimmsPerNode !== preset?.dimmsPerNode)

  return { size, cpuModelId, dimmModelId, dimmsPerNode, custom }
}
