import { createEmptyPlan, DEFAULT_RACK_DEFAULTS, defaultFabric, defaultRack } from './defaults'
import type { Partition, Plan, Rack, ServerGroup } from './plan'

// Starting points for a new plan. Each template builds a fresh Plan with new
// ids every time, so loading one twice never aliases racks. They are meant
// to be valid out of the box — templates.test.ts checks that none of them
// raises a validation error.

export interface PlanTemplate {
  id: string
  name: string
  description: string
  build: () => Plan
}

function id(): string {
  return crypto.randomUUID()
}

function group(
  role: ServerGroup['role'],
  modelId: string,
  count: number,
  uplink: ServerGroup['uplink'] = '2x25G',
): ServerGroup {
  return { id: id(), role, modelId, count, uplink }
}

/** Rack group: 112 MicroCloud workers (14 chassis, spread mid → left),
 *  optionally with storage servers. The 2x AS7726 leaf pair has 60 ports for
 *  servers; 112 workers + 3 storage on 2x25G use 58. */
function rackGroup(name: string, memberNames: [string, string, string], storageServers = 0): Rack {
  const rack = defaultRack(name, 'rack-group', DEFAULT_RACK_DEFAULTS, memberNames)
  rack.servers = [group('worker', 'server-microcloud-h13', 112)]
  if (storageServers > 0) {
    rack.servers.push(group('storage', 'server-superserver-tn12', storageServers))
  }
  return rack
}

/** One partition with a redundant management network, two rack groups and
 *  three storage servers. */
function productionPartition(name: string): Partition {
  const fabric = defaultFabric()
  fabric.mgmt.redundant = true
  return {
    id: id(),
    name,
    fabric,
    racks: [
      rackGroup('Rack group 1', ['Rack 1', 'Rack 2', 'Rack 3'], 3),
      rackGroup('Rack group 2', ['Rack 4', 'Rack 5', 'Rack 6']),
    ],
    rackDefaults: { ...DEFAULT_RACK_DEFAULTS },
  }
}

function plan(name: string, partitions: Partition[]): Plan {
  return { ...createEmptyPlan(), name, partitions }
}

export const templates: PlanTemplate[] = [
  {
    id: 'poc',
    name: 'PoC',
    description:
      'One partition, non-redundant management network, one rack with 8 workers on a leaf pair.',
    build: () => {
      const fabric = defaultFabric()
      fabric.mgmt.redundant = false
      const rack = defaultRack('Rack 1')
      rack.leafCount = 2
      rack.servers = [group('worker', 'server-microcloud-h13', 8)]
      return plan('PoC', [
        {
          id: id(),
          name: 'Partition 1',
          fabric,
          racks: [rack],
          rackDefaults: { ...DEFAULT_RACK_DEFAULTS },
        },
      ])
    },
  },
  {
    id: 'production',
    name: 'Production',
    description:
      'One partition, redundant management network, two rack groups with 224 workers and 3 storage servers.',
    build: () => plan('Production', [productionPartition('Partition 1')]),
  },
  {
    id: 'three-partitions',
    name: 'Three partitions',
    description: 'Three separate partitions, each like the Production template.',
    build: () =>
      plan('Three partitions', [
        productionPartition('Partition 1'),
        productionPartition('Partition 2'),
        productionPartition('Partition 3'),
      ]),
  },
]
