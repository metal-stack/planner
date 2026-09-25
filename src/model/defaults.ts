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
  memberNames?: Rack['memberNames'],
): Rack {
  return {
    id: id(),
    name,
    kind,
    ...(kind === 'rack-group' && {
      memberNames: memberNames ?? [`${name} (left)`, `${name} (middle)`, `${name} (right)`],
    }),
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

// Default names. Every physical rack gets its own "Rack <N>" and every
// group its own "Rack group <N>", numbered above the highest number in use
// rather than into gaps, so numbers keep rising left to right. Names stay
// editable; validate.ts warns about duplicates.

/** Names of the physical racks of a partition: a single rack's name, a
 *  rack group's three member names. The central rack is not included. */
export function physicalRackNames(partition: Partition): string[] {
  return partition.racks.flatMap((rack) =>
    rack.kind === 'rack-group' && rack.memberNames ? rack.memberNames : [rack.name],
  )
}

function nextNumber(names: string[], prefix: string): number {
  const pattern = new RegExp(`^${prefix} (\\d+)$`)
  return names.reduce((max, name) => Math.max(max, Number(pattern.exec(name)?.[1] ?? 0)), 0) + 1
}

/** The next `count` free physical rack names, "Rack <N>" upwards. */
export function nextRackNames(partition: Partition, count: number): string[] {
  const first = nextNumber(physicalRackNames(partition), 'Rack')
  return Array.from({ length: count }, (_, i) => `Rack ${first + i}`)
}

/** The next free group name, "Rack group <N>". */
export function nextGroupName(partition: Partition): string {
  const groups = partition.racks.filter((r) => r.kind === 'rack-group').map((r) => r.name)
  return `Rack group ${nextNumber(groups, 'Rack group')}`
}

/** A rack to append to `partition`, with the next free name(s). */
export function newRack(partition: Partition, kind: Rack['kind']): Rack {
  if (kind === 'single')
    return defaultRack(nextRackNames(partition, 1)[0], kind, partition.rackDefaults)
  const [left, middle, right] = nextRackNames(partition, 3)
  return defaultRack(nextGroupName(partition), kind, partition.rackDefaults, [left, middle, right])
}

/** `rack` switched to `kind`, renamed so every physical rack keeps a unique
 *  name: a single rack becomes the left rack of the new group (the two new
 *  racks take the next free numbers); a group becomes its middle rack, the
 *  one holding the leaves and the mgmt leaf. */
export function withRackKind(partition: Partition, rack: Rack, kind: Rack['kind']): Rack {
  if (rack.kind === kind) return rack
  if (kind === 'rack-group') {
    const [second, third] = nextRackNames(partition, 2)
    return {
      ...rack,
      kind,
      name: nextGroupName(partition),
      memberNames: [rack.name, second, third],
    }
  }
  const { memberNames, ...single } = rack
  return { ...single, kind, name: memberNames?.[1] ?? rack.name }
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
