import { describe, expect, it } from 'vitest'
import { createEmptyPlan, withRackKind } from '../model/defaults'
import { deriveRackLayout, physicalRackCount } from './rackLayout'
import { validatePlan } from './validate'

describe('deriveRackLayout', () => {
  it('fills the central rack with fabric and management gear from the top', () => {
    const layout = deriveRackLayout(createEmptyPlan())[0]
    const central = layout.racks[0]

    expect(central.name).toBe('Central rack')
    expect(central.maxPowerWatts).toBe(12000)
    // 2 routers + 2 exits + 2 spines + 2 mgmt spines + 2 mgmt servers, all 1U
    expect(central.slots).toHaveLength(10)
    expect(central.usedU).toBe(10)
    expect(central.slots[0]).toMatchObject({ label: 'Router 1', topU: 42, units: 1 })
    expect(central.slots[2]).toMatchObject({ label: 'Exit 1', topU: 40, units: 1 })
    expect(central.slots[9].topU).toBe(33)
  })

  it('lays out a compute rack: mgmt leaf on top, leaves, then server chassis', () => {
    const layout = deriveRackLayout(createEmptyPlan())[0]
    const rack = layout.racks[1]

    // 1 mgmt leaf (1U) + 2 leaves (1U) + 1 MicroCloud chassis (3U)
    expect(rack.slots.map((s) => s.label)).toEqual([
      'Mgmt leaf',
      'Leaf 1',
      'Leaf 2',
      'AS-3015MR-H8TNR',
    ])
    expect(rack.usedU).toBe(6)
    const chassis = rack.slots[3]
    expect(chassis).toMatchObject({ units: 3, topU: 39, sublabel: '8 × worker' })
  })

  it('splits a group into chassis and labels the partial one', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].racks[0].servers[0].count = 11 // 8 per chassis -> 8 + 3
    const layout = deriveRackLayout(plan)[0]
    const chassisSlots = layout.racks[1].slots.filter((s) => s.kind === 'server')
    expect(chassisSlots).toHaveLength(2)
    expect(chassisSlots[0].sublabel).toBe('8 × worker')
    expect(chassisSlots[1].sublabel).toBe('3 × worker')
  })

  it('flags a rack whose devices exceed its height', () => {
    const plan = createEmptyPlan()
    // 14 MicroCloud chassis x 3U + 3U of switches = 45U > 42U
    plan.partitions[0].racks[0].servers[0].count = 14 * 8
    const layout = deriveRackLayout(plan)[0]
    expect(layout.racks[1].usedU).toBe(45)
    const errors = validatePlan(plan).filter((i) => i.severity === 'error')
    expect(errors.some((i) => i.message.includes('Rack height exceeded: 45U of 42U'))).toBe(true)
  })
})

describe('rack group', () => {
  it('distributes chassis evenly by used height with switches in the middle', () => {
    const plan = createEmptyPlan()
    const partition = plan.partitions[0]
    const rack = withRackKind(partition, partition.racks[0], 'rack-group')
    partition.racks = [rack]
    // 14 chassis x 3U over three racks; mid starts with 3U of switches
    rack.servers[0].count = 14 * 8
    const layout = deriveRackLayout(plan)[0]
    const [left, mid, right] = layout.racks.slice(1)

    expect([left.name, mid.name, right.name]).toEqual(['Rack 1', 'Rack 2', 'Rack 3'])
    expect(layout.racks.slice(1).map((r) => r.group)).toEqual(
      Array(3).fill({ id: rack.id, name: 'Rack group 1' }),
    )
    expect(layout.racks[0].group).toBeUndefined()
    expect(mid.slots.slice(0, 3).map((s) => s.label)).toEqual(['Mgmt leaf', 'Leaf 1', 'Leaf 2'])
    expect([left.usedU, mid.usedU, right.usedU]).toEqual([15, 15, 15])
  })

  it('spreads a storage group across the racks even when workers fill them unevenly', () => {
    const plan = createEmptyPlan()
    const partition = plan.partitions[0]
    const rack = withRackKind(partition, partition.racks[0], 'rack-group')
    partition.racks = [rack]
    // 13 worker chassis x 3U pack to 15/15/12U; without the per-group spread
    // the emptiest rack would then take two of the three 2U storage systems.
    rack.servers[0].count = 13 * 8
    rack.servers.push({
      id: 'storage',
      role: 'storage',
      modelId: 'server-superserver-tn12',
      count: 3,
      uplink: '2x25G',
      sizeId: 'n1-medium-x86',
      nodeConfigs: {},
    })
    const layout = deriveRackLayout(plan)[0]
    for (const physical of layout.racks.slice(1)) {
      expect(physical.slots.filter((s) => s.kind === 'storage')).toHaveLength(1)
    }
  })

  it('flags overflow when the three racks are full', () => {
    const plan = createEmptyPlan()
    const partition = plan.partitions[0]
    const rack = withRackKind(partition, partition.racks[0], 'rack-group')
    partition.racks = [rack]
    // 42 chassis x 3U = 126U > 3x42U minus 3U of switches
    rack.servers[0].count = 42 * 8
    rack.servers[0].uplink = '2x100G'
    const layout = deriveRackLayout(plan)[0]
    expect(layout.racks.slice(1).some((r) => r.usedU > r.heightUnits)).toBe(true)
    const errors = validatePlan(plan).filter((i) => i.severity === 'error')
    expect(errors.some((i) => i.message.includes('Rack height'))).toBe(true)
  })

  it('counts physical racks: central rack plus one or three per plan rack', () => {
    const plan = createEmptyPlan()
    const partition = plan.partitions[0]
    expect(physicalRackCount(partition)).toBe(2)
    partition.racks[0] = withRackKind(partition, partition.racks[0], 'rack-group')
    expect(physicalRackCount(partition)).toBe(4)
  })

  it('estimates rack power from the catalog, scaling partial chassis', () => {
    const plan = createEmptyPlan()
    const layout = deriveRackLayout(plan)[0]
    // 2x AS7726 (300 W) + AS4630 (90 W) + one full MicroCloud (2000 W)
    expect(layout.racks[1].powerWatts).toBe(2690)
    // 2 routers (400 W) + 2 exits + 2 spines (300 W) + 2 mgmt spines (90 W) + 2 mgmt servers (500 W)
    expect(layout.racks[0].powerWatts).toBe(3180)

    plan.partitions[0].racks[0].servers[0].count = 4 // half a MicroCloud
    expect(deriveRackLayout(plan)[0].racks[1].powerWatts).toBe(690 + 1000)
  })

  it('adds per-position GPU watts to every chassis holding that position', () => {
    const plan = createEmptyPlan()
    const group = plan.partitions[0].racks[0].servers[0]
    group.count = 9 // a full chassis plus one node in a second
    group.nodeConfigs = {
      0: { sizeId: 'n1-medium-x86', gpu: { modelId: 'gpu-h100-pcie', perNode: 1 } },
    }
    const layout = deriveRackLayout(plan)[0]
    const chassis = layout.racks[1].slots.filter((s) => s.kind === 'server')
    // Position 1 exists in both chassis, so each carries a 350 W H100.
    expect(chassis[0].powerWatts).toBe(2000 + 350)
    expect(chassis[1].powerWatts).toBe(250 + 350)
  })
})
