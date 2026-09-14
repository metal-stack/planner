import { defaultIpPlan } from './ipPlan'
import { SCHEMA_VERSION } from './migrate'
import type { FabricConfig, Partition, Plan, Rack, RackDefaults } from './plan'

function id(): string {
  return crypto.randomUUID()
}

export function defaultFabric(): FabricConfig {
  return {
    fabricType: 'leaf-spine',
    spineModelId: 'switch-as7726',
    spineCount: 2,
    superspineModelId: 'switch-as7726',
    superspineCount: 0,
    exitModelId: 'switch-as7726',
    exitSwitchCount: 2,
    routerCount: 2,
    storageLeafModelId: 'switch-as7726',
    storageLeafCount: 0,
    mgmt: {
      layer: 'l3',
      redundant: true,
      spineModelId: 'switch-as4630',
      leafModelId: 'switch-as4630',
      leafPerRack: 1,
      serverModelId: 'server-mgmt-121h',
    },
    leafSpineLinks: 1,
    nonBlocking: false,
    nos: 'broadcom-sonic',
  }
}

// 12 kW per rack: five 3U eight-node MicroCloud chassis at ~2 kW each plus
// a leaf pair no longer fit in 10 kW, and that is the density these
// templates are built around.
export const DEFAULT_RACK_DEFAULTS: RackDefaults = { heightUnits: 42, maxPowerWatts: 12000 }

export function defaultRack(
  name: string,
  kind: Rack['kind'] = 'single',
  defaults: RackDefaults = DEFAULT_RACK_DEFAULTS,
): Rack {
  return {
    id: id(),
    name,
    kind,
    heightUnits: defaults.heightUnits,
    maxPowerWatts: defaults.maxPowerWatts,
    leafModelId: 'switch-as7726',
    leafCount: 2,
    servers: [
      {
        id: id(),
        role: 'worker',
        modelId: 'server-microcloud-h13',
        count: 8,
        uplink: '2x25G',
      },
    ],
  }
}

export function defaultPartition(name: string): Partition {
  return {
    id: id(),
    name,
    fabric: defaultFabric(),
    racks: [defaultRack('Rack 1')],
    rackDefaults: { ...DEFAULT_RACK_DEFAULTS },
  }
}

export function createEmptyPlan(): Plan {
  const now = new Date().toISOString()
  return {
    schemaVersion: SCHEMA_VERSION,
    id: id(),
    name: 'New metal-stack plan',
    createdAt: now,
    updatedAt: now,
    topology: 'single-zone',
    partitions: [defaultPartition('Partition 1')],
    sparesPerLine: 2,
    ipPlan: defaultIpPlan(),
    externalNetworks: [
      {
        id: id(),
        name: 'Internet',
        kind: 'internet',
        attachedPartitionId: '',
      },
    ],
  }
}
