import { catalog, heightInRack, itemLabel } from '../model/catalog'
import { nodeConfig } from '../model/nodeConfig'
import {
  mgmtDeviceCount,
  type FabricConfig,
  type Partition,
  type Plan,
  type Rack,
  type RackWidth,
} from '../model/plan'
import { chassisCount } from './servers'
import { hasOwnRack, inCentralRack } from './controlPlane'
import { orv3Infrastructure } from './orv3'

// Derives physical rack elevations (which device sits in which height
// units) from the Plan. Like the BOM, the layout is always computed, never
// stored. Devices fill each rack from the top: network gear first, then
// server chassis — the classic ToR arrangement.

export type SlotKind = 'network' | 'mgmt' | 'server' | 'storage' | 'control-plane' | 'power'

export interface RackSlot {
  label: string
  sublabel?: string
  units: number
  /** Rack unit of the slot's top edge, counted 1-based from the bottom;
   *  slots below 1 overflow the rack. */
  topU: number
  kind: SlotKind
  /** Estimated power draw of the device in this slot, W. */
  powerWatts: number
}

export interface RackElevation {
  id: string
  /** The plan rack this elevation belongs to; unset for the central rack. */
  rackId?: string
  name: string
  heightUnits: number
  widthInches: RackWidth
  slots: RackSlot[]
  usedU: number
  /** Estimated total power draw of the rack, W (sum of its slots). */
  powerWatts: number
  /** Power budget of the rack, W (rack setting; partition default for the central rack). */
  maxPowerWatts: number
  /** Set on the three physical racks of a rack group. */
  group?: { id: string; name: string }
  /** Rear-mounted infrastructure, not shown in the diagram and consumes no OU. */
  busBar?: { label: string }
}

export interface PartitionRackLayout {
  partitionId: string
  partitionName: string
  racks: RackElevation[]
}

export type RackPosition = 'left' | 'mid' | 'right'

interface Item {
  label: string
  sublabel?: string
  units: number
  kind: SlotKind
  powerWatts: number
  /** Set on server chassis: the group it belongs to and the nodes it holds. */
  groupId?: string
  nodes?: number
}

/** One physical rack of a plan rack: a single rack has one (no position);
 *  a rack group has left/mid/right, with the switches in the middle and
 *  chassis distributed evenly by used height (each chassis goes to the
 *  physical rack holding the fewest chassis of its group, the least-used
 *  one among those; ties favor mid, then left, then right). Spreading each
 *  group first keeps e.g. storage systems across the racks even when the
 *  worker chassis fill them unevenly. A chassis that fits nowhere lands in
 *  the chosen rack, where the height check flags it. */
export interface PhysicalRack {
  position?: RackPosition
  name: string
  switches: Item[]
  chassis: Item[]
}

/** Physical racks of a plan rack, shared by the elevation view and the
 *  topology graph so both show the same spread. The mgmt leaf sits at the
 *  top of the rack, above the leaves. */
export function physicalRacks(rack: Rack, fabric: FabricConfig): PhysicalRack[] {
  const switches: Item[] = [
    ...device(
      'Mgmt leaf',
      fabric.mgmt.leafModelId,
      fabric.mgmt.leafPerRack,
      'mgmt',
      rack.widthInches,
    ),
    ...device('Leaf', rack.leafModelId, rack.leafCount, 'network', rack.widthInches),
  ]
  const chassis: Item[] = rack.servers.flatMap((group) => {
    const count = chassisCount(group)
    const nodesPer = catalog[group.modelId]?.nodesPerChassis ?? 1
    // Server powerWatts covers a typical CPU and memory configuration, so
    // adding CPU TDP would double-count it. GPUs are genuinely additive
    // and may differ per chassis position; a chassis holding `nodes` nodes
    // fills its positions 0 to nodes - 1.
    const gpuWatts = (position: number) => {
      const gpu = nodeConfig(group, position).gpu
      return (gpu?.perNode ?? 0) * (catalog[gpu?.modelId ?? '']?.powerWatts ?? 0)
    }
    return repeat(count, (i) => {
      const nodes = Math.min(nodesPer, group.count - i * nodesPer)
      let chassisGpuWatts = 0
      for (let n = 0; n < nodes; n++) chassisGpuWatts += gpuWatts(n)
      return {
        label: part(group.modelId),
        sublabel: `${nodes} × ${group.role}`,
        units: heightInRack(group.modelId, rack.widthInches),
        kind: group.role === 'storage' ? 'storage' : ('server' as SlotKind),
        // Partial chassis draw proportionally less.
        powerWatts:
          Math.round(((catalog[group.modelId]?.powerWatts ?? 0) * nodes) / nodesPer) +
          chassisGpuWatts,
        groupId: group.id,
        nodes,
      }
    })
  })

  if (rack.kind === 'single') return [{ name: rack.name, switches, chassis }]

  const mid = { items: [] as Item[], used: switches.reduce((u, i) => u + i.units, 0) }
  const left = { items: [] as Item[], used: 0 }
  const right = { items: [] as Item[], used: 0 }
  const chassisOfGroup = (bin: { items: Item[] }, groupId?: string) =>
    bin.items.filter((item) => item.groupId === groupId).length
  for (const c of chassis) {
    const target = [mid, left, right].reduce((best, r) => {
      const spread = chassisOfGroup(r, c.groupId) - chassisOfGroup(best, c.groupId)
      return spread < 0 || (spread === 0 && r.used < best.used) ? r : best
    })
    target.items.push(c)
    target.used += c.units
  }
  const [leftName, midName, rightName] = rack.memberNames ?? [
    `${rack.name} (left)`,
    `${rack.name} (middle)`,
    `${rack.name} (right)`,
  ]
  return [
    { position: 'left', name: leftName, switches: [], chassis: left.items },
    { position: 'mid', name: midName, switches, chassis: mid.items },
    { position: 'right', name: rightName, switches: [], chassis: right.items },
  ]
}

/** Rack slots are labelled by model, not by ordering code. */
function part(modelId: string): string {
  return itemLabel(modelId)
}

function repeat(n: number, make: (i: number) => Item): Item[] {
  return Array.from({ length: n }, (_, i) => make(i))
}

function device(
  labelPrefix: string,
  modelId: string,
  count: number,
  kind: SlotKind,
  widthInches: RackWidth = 19,
): Item[] {
  return repeat(count, (i) => ({
    label: count > 1 ? `${labelPrefix} ${i + 1}` : labelPrefix,
    sublabel: part(modelId),
    units: heightInRack(modelId, widthInches),
    kind,
    powerWatts: catalog[modelId]?.powerWatts ?? 0,
  }))
}

function place(
  items: Item[],
  heightUnits: number,
): { slots: RackSlot[]; usedU: number; powerWatts: number } {
  let offset = 0
  const slots = items.map((item) => {
    const topU = heightUnits - offset
    offset += item.units
    return { ...item, topU }
  })
  return { slots, usedU: offset, powerWatts: items.reduce((w, i) => w + i.powerWatts, 0) }
}

/** Power shelves use mounting space but supply the existing equipment load;
 * their output capacity must not be added to the rack's power consumption.
 * Positions are schematic, with power shelves above switches and servers. */
function withPowerInfrastructure(rack: RackElevation): RackElevation {
  const infrastructure = orv3Infrastructure(rack)
  if (!infrastructure) return rack
  const { shelfId, psusPerShelf, psuCapacityWatts } = infrastructure
  const shelves: Item[] = ['A', 'B'].flatMap((feed) =>
    psusPerShelf.map((psus, i) => ({
      label: `Power shelf ${feed}${i + 1}`,
      sublabel: `${formatPower(psus * psuCapacityWatts)} fitted`,
      units: catalog[shelfId].heightUnits!,
      kind: 'power',
      powerWatts: 0,
    })),
  )
  return {
    ...rack,
    busBar: { label: 'DC bus bar · rear' },
    ...place([...shelves, ...rack.slots], rack.heightUnits),
  }
}

/** "1.6 kW" / "450 W" for rack headers. */
export function formatPower(watts: number): string {
  return watts >= 1000 ? `${(watts / 1000).toFixed(1)} kW` : `${watts} W`
}

/** Physical racks in a partition: the central rack plus one per single
 *  rack and three per rack group. */
export function physicalRackCount(partition: Partition): number {
  return (
    1 + partition.racks.reduce((n, rack) => n + physicalRacks(rack, partition.fabric).length, 0)
  )
}

export function deriveRackLayout(plan: Plan): PartitionRackLayout[] {
  return plan.partitions.map((partition) => {
    const { fabric } = partition
    const mgmtCount = mgmtDeviceCount(fabric.mgmt)

    const centralDevice = (label: string, modelId: string, count: number, kind: SlotKind) =>
      device(label, modelId, count, kind, partition.rackDefaults.widthInches)
    const centralItems: Item[] = [
      ...centralDevice('Router', 'router-internet', fabric.routerCount, 'network'),
      ...centralDevice('Exit', fabric.exitModelId, fabric.exitSwitchCount, 'network'),
      ...(fabric.fabricType === 'leaf-spine-superspine'
        ? centralDevice('Superspine', fabric.superspineModelId, fabric.superspineCount, 'network')
        : []),
      ...centralDevice('Spine', fabric.spineModelId, fabric.spineCount, 'network'),
      ...centralDevice(
        'Storage leaf',
        fabric.storageLeafModelId,
        fabric.storageLeafCount,
        'storage',
      ),
      ...centralDevice('Mgmt spine', fabric.mgmt.spineModelId, mgmtCount, 'mgmt'),
      ...centralDevice('Mgmt server', fabric.mgmt.serverModelId, mgmtCount, 'mgmt'),
      // On-prem control-plane nodes, when they share the central rack.
      ...(inCentralRack(plan, partition)
        ? centralDevice(
            'Control plane node',
            plan.controlPlane.nodeModelId,
            plan.controlPlane.nodeCount,
            'control-plane',
          )
        : []),
    ]
    const central: RackElevation = {
      id: `${partition.id}/central`,
      name: 'Central rack',
      widthInches: partition.rackDefaults.widthInches,
      heightUnits: partition.rackDefaults.heightUnits,
      maxPowerWatts: partition.rackDefaults.maxPowerWatts,
      ...place(centralItems, partition.rackDefaults.heightUnits),
    }

    const racks = partition.racks.flatMap((rack): RackElevation[] =>
      physicalRacks(rack, fabric).map((phys) => ({
        id: phys.position
          ? `${partition.id}/${rack.id}/${phys.position}`
          : `${partition.id}/${rack.id}`,
        rackId: rack.id,
        name: phys.name,
        ...(phys.position && { group: { id: rack.id, name: rack.name } }),
        widthInches: rack.widthInches,
        heightUnits: rack.heightUnits,
        maxPowerWatts: rack.maxPowerWatts,
        ...place([...phys.switches, ...phys.chassis], rack.heightUnits),
      })),
    )

    // The control-plane rack, when the nodes get one of their own: its
    // leaf pair and mgmt leaf on top, the nodes below, like a compute rack.
    const cp = plan.controlPlane
    const controlPlaneRacks: RackElevation[] = hasOwnRack(plan, partition)
      ? [
          {
            id: `${partition.id}/control-plane`,
            name: cp.rack.name,
            widthInches: cp.rack.widthInches,
            heightUnits: cp.rack.heightUnits,
            maxPowerWatts: cp.rack.maxPowerWatts,
            ...place(
              [
                ...device(
                  'Mgmt leaf',
                  fabric.mgmt.leafModelId,
                  fabric.mgmt.leafPerRack,
                  'mgmt',
                  cp.rack.widthInches,
                ),
                ...device(
                  'Leaf',
                  cp.rack.leafModelId,
                  cp.rack.leafCount,
                  'network',
                  cp.rack.widthInches,
                ),
                ...device(
                  'Control plane node',
                  cp.nodeModelId,
                  cp.nodeCount,
                  'control-plane',
                  cp.rack.widthInches,
                ),
              ],
              cp.rack.heightUnits,
            ),
          },
        ]
      : []

    return {
      partitionId: partition.id,
      partitionName: partition.name,
      racks: [central, ...racks, ...controlPlaneRacks].map(withPowerInfrastructure),
    }
  })
}
