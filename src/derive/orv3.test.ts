import { describe, expect, it } from 'vitest'
import { createEmptyPlan, defaultPartition, newRack, withRackKind } from '../model/defaults'
import { catalog, heightInRack, serversForUsage } from '../model/catalog'
import { exportPlanJson, importPlanJson } from '../io/json'
import { usePlanStore } from '../store/planStore'
import { deriveBom, deriveBomByPartition, rackBmcPorts, type BomScope } from './bom'
import { deriveRackLayout } from './rackLayout'
import { validatePlan } from './validate'
import { orv3Infrastructure } from './orv3'

function orv3Plan(count = 3) {
  const plan = createEmptyPlan()
  const rack = plan.partitions[0].racks[0]
  rack.widthInches = 21
  rack.servers[0].modelId = 'server-gigabyte-to25-s12'
  rack.servers[0].count = count
  return plan
}

describe('ORV3 rack and power BOM', () => {
  const frameId = 'rack-gigabyte-doa3-st0'
  const shelfId = 'power-orv3-shelf'
  const psuId = 'power-orv3-psu-5500w'
  const blankId = 'power-orv3-psu-blank'
  const cableSetId = 'power-orv3-input-cable-set'
  const ids = [frameId, shelfId, cableSetId]
  const quantity = (plan: ReturnType<typeof createEmptyPlan>, id: string) =>
    deriveBom(plan).find((line) => line.catalogId === id)?.quantity ?? 0

  it('adds a frame with bus bar, redundant populated shelves and input sets per ORV3 rack', () => {
    const plan = orv3Plan()
    expect(ids.map((id) => quantity(plan, id))).toEqual([1, 2, 2])
    const shelves = deriveBom(plan).find((line) => line.catalogId === shelfId)!
    expect(shelves.reasons).toHaveLength(1)
    expect(shelves.reasons[0].where).toBe(plan.partitions[0].racks[0].name)
    expect(shelves.reasons[0].detail).toContain('N+N')
    expect(shelves.reasons[0].detail).toContain('controller included, PSUs ordered separately')
    expect(deriveBom(plan).filter((line) => line.category === 'power')).toHaveLength(4)
    expect(quantity(plan, psuId)).toBe(2)
    expect(quantity(plan, blankId)).toBe(10)
    expect(quantity(plan, 'power-orv3-shelf-33kw')).toBe(0)
    expect(deriveBom(plan).some((line) => ids.some((id) => line.catalogId === `${id}#spare`))).toBe(
      false,
    )
    expect(ids.map((id) => quantity(createEmptyPlan(), id))).toEqual([0, 0, 0])
  })

  it('scales with server load, including partial trays, independently of the rack budget', () => {
    const plan = orv3Plan()
    const rack = plan.partitions[0].racks[0]
    rack.leafCount = 0
    plan.partitions[0].fabric.mgmt.leafPerRack = 0
    for (const [nodes, shelves] of [
      [0, 0],
      [82, 2], // 32.8 kW
      [83, 4], // 33.2 kW, including a half-populated tray
      [165, 4], // Exactly 66 kW
      [166, 6],
    ]) {
      rack.servers[0].count = nodes
      expect(quantity(plan, shelfId)).toBe(shelves)
      expect(quantity(plan, cableSetId)).toBe(shelves)
      expect(quantity(plan, frameId)).toBe(1)
    }
    rack.maxPowerWatts = 100000
    expect(quantity(plan, shelfId)).toBe(6)
    rack.servers[0].count = 3
    expect(quantity(plan, shelfId)).toBe(2)
  })

  it.each([
    [0, 0, 0, 0, []],
    [5500, 2, 2, 10, [1]],
    [5501, 2, 4, 8, [2]],
    [33000, 2, 12, 0, [6]],
    [33001, 4, 14, 10, [6, 1]],
  ])(
    'fits PSU modules and blanks for %s W with enough capacity on either feed',
    (powerWatts, shelves, psus, blanks, population) => {
      const infrastructure = orv3Infrastructure({ widthInches: 21, powerWatts })!
      expect(infrastructure.shelfCount).toBe(shelves)
      expect(infrastructure.psuCount).toBe(psus)
      expect(infrastructure.blankCount).toBe(blanks)
      expect(infrastructure.psusPerShelf).toEqual(population)
      expect(infrastructure.psusPerFeed * infrastructure.psuCapacityWatts).toBeGreaterThanOrEqual(
        powerWatts,
      )
    },
  )

  it('changes fitted capacity and BOM PSU counts when server load changes', () => {
    const plan = orv3Plan(12) // 4.8 kW of servers + 690 W of switches.
    const rack = plan.partitions[0].racks[0]
    const fitted = () =>
      deriveRackLayout(plan)[0].racks[1].slots.filter((slot) => slot.kind === 'power')
    expect(quantity(plan, psuId)).toBe(2)
    expect(quantity(plan, blankId)).toBe(10)
    expect(fitted().map((slot) => slot.sublabel)).toEqual(['5.5 kW fitted', '5.5 kW fitted'])
    rack.servers[0].count = 13
    expect(quantity(plan, psuId)).toBe(4)
    expect(quantity(plan, blankId)).toBe(8)
    expect(fitted().map((slot) => slot.sublabel)).toEqual(['11.0 kW fitted', '11.0 kW fitted'])
    expect(fitted().every((slot) => slot.powerWatts === 0)).toBe(true)
    expect(quantity(plan, shelfId)).toBe(2)
    rack.maxPowerWatts = 100000
    expect(quantity(plan, psuId)).toBe(4)
    rack.servers = []
    rack.leafCount = 0
    plan.partitions[0].fabric.mgmt.leafPerRack = 0
    for (const id of [shelfId, psuId, blankId, cableSetId]) expect(quantity(plan, id)).toBe(0)
  })

  it.each([
    [33000, 2],
    [33001, 4],
  ])('rounds up at the shelf capacity boundary: %s W', (powerWatts, shelfCount) => {
    expect(orv3Infrastructure({ widthInches: 21, powerWatts })?.shelfCount).toBe(shelfCount)
  })

  it('sizes rack-group members individually and leaves empty frames without shelves', () => {
    const plan = orv3Plan(0)
    const partition = plan.partitions[0]
    partition.racks[0] = withRackKind(partition, partition.racks[0], 'rack-group')
    // Only the middle rack has equipment (shared switches).
    expect(ids.map((id) => quantity(plan, id))).toEqual([3, 2, 2])
    partition.racks[0].servers[0].count = 246
    // 32.8 kW of servers in each member, plus 690 W of switches in the middle.
    expect(ids.map((id) => quantity(plan, id))).toEqual([3, 8, 8])
    const shelves = deriveBom(plan).find((line) => line.catalogId === shelfId)!
    expect(shelves.reasons.map((reason) => reason.quantity)).toEqual([2, 4, 2])
    expect(deriveBom(plan).find((line) => line.catalogId === psuId)!.reasons[1].detail).toContain(
      '33490 W estimated equipment load',
    )
    expect(deriveBom(plan).find((line) => line.catalogId === shelfId)?.reasons[0].where).toBe(
      partition.racks[0].name,
    )
  })

  it('includes GPUs and per-position overrides in the equipment load', () => {
    const plan = orv3Plan(44)
    const group = plan.partitions[0].racks[0].servers[0]
    expect(quantity(plan, shelfId)).toBe(2)
    group.gpu = { modelId: 'gpu-h100-pcie', perNode: 1 }
    // 17.6 kW servers + 15.4 kW GPUs + 690 W switches.
    expect(quantity(plan, shelfId)).toBe(4)
    group.nodeConfigs = { 0: { sizeId: group.sizeId } }
    // Only half of the nodes now have a GPU.
    expect(quantity(plan, shelfId)).toBe(2)
  })

  it('sizes central and separate control-plane shelves from their hosted equipment', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].rackDefaults.widthInches = 21
    const cp = plan.controlPlane
    cp.hosting = 'on-prem'
    cp.nodeCount = 100
    cp.rack.widthInches = 21
    // The management server model draws 400 W per node.
    expect(quantity(plan, shelfId)).toBe(4)
    cp.placement = 'own-rack'
    expect(quantity(plan, shelfId)).toBe(6) // Central pair plus four for the control plane.
    cp.nodeCount = 3
    expect(quantity(plan, shelfId)).toBe(4)
    cp.hosting = 'kaas'
    expect(quantity(plan, shelfId)).toBe(2)
  })

  it('includes central and hosted control-plane racks once in their host partition', () => {
    const plan = createEmptyPlan()
    plan.partitions.push(defaultPartition('Partition 2'))
    const host = plan.partitions[1]
    host.rackDefaults.widthInches = 21
    plan.controlPlane.hosting = 'on-prem'
    plan.controlPlane.partitionId = host.id
    plan.controlPlane.rack.widthInches = 21
    // Hosted nodes share the central frame and power infrastructure.
    expect(ids.map((id) => quantity(plan, id))).toEqual([1, 2, 2])
    plan.controlPlane.placement = 'own-rack'
    expect(ids.map((id) => quantity(plan, id))).toEqual([2, 4, 4])
    const partitionBoms = deriveBomByPartition(plan)
    expect(partitionBoms[0].lines.some((line) => ids.includes(line.catalogId))).toBe(false)
    for (const id of ids) {
      expect(partitionBoms[1].lines.find((line) => line.catalogId === id)?.quantity).toBe(
        quantity(plan, id),
      )
    }
    expect(
      deriveBom(plan)
        .find((line) => line.catalogId === frameId)
        ?.reasons.map((reason) => reason.where),
    ).toEqual(['Partition 2 - Central rack', `Partition 2 - ${plan.controlPlane.rack.name}`])
    plan.controlPlane.hosting = 'kaas'
    expect(ids.map((id) => quantity(plan, id))).toEqual([1, 2, 2])
  })

  it('assigns shared infrastructure to production without duplicating it in management', () => {
    const plan = orv3Plan()
    plan.partitions[0].rackDefaults.widthInches = 21
    for (const id of ids) {
      expect(deriveBom(plan, 'production').find((line) => line.catalogId === id)?.quantity).toBe(
        quantity(plan, id),
      )
      expect(deriveBom(plan, 'management').some((line) => line.catalogId === id)).toBe(false)
    }
    const all = deriveBom(plan).filter((line) => line.category !== 'spare')
    for (const line of all) {
      const split = (['production', 'management'] as const).reduce(
        (sum, scope) =>
          sum +
          (deriveBom(plan, scope).find((item) => item.catalogId === line.catalogId)?.quantity ?? 0),
        0,
      )
      expect(split, line.catalogId).toBe(line.quantity)
    }
  })

  it('includes shelf space in elevation and height validation', () => {
    const plan = orv3Plan()
    const rack = plan.partitions[0].racks[0]
    rack.heightUnits = 9
    expect(deriveRackLayout(plan)[0].racks[1].usedU).toBe(9)
    expect(validatePlan(plan).some((issue) => issue.message.includes('Rack height exceeded'))).toBe(
      false,
    )
    rack.heightUnits = 8
    expect(validatePlan(plan).some((issue) => issue.message.includes('9OU of 8OU'))).toBe(true)
    rack.heightUnits = 43
    expect(
      validatePlan(plan).some((issue) => issue.message.includes('exceeds the reference ORV3')),
    ).toBe(false)
    rack.heightUnits = 44
    expect(
      validatePlan(plan).some((issue) => issue.message.includes('43OU mounting capacity')),
    ).toBe(true)
    rack.servers[0].count = 83
    expect(
      validatePlan(plan).some((issue) => issue.message.includes('includes 4OU of power shelves')),
    ).toBe(true)
    expect(deriveRackLayout(plan)[0].racks[1].usedU).toBe(91)
  })
})

describe('ORV3 racks', () => {
  it('shows bus bars and exactly the BOM shelf count across all physical rack types', () => {
    const plan = orv3Plan(246)
    const partition = plan.partitions[0]
    partition.rackDefaults.widthInches = 21
    partition.racks[0] = withRackKind(partition, partition.racks[0], 'rack-group')
    plan.controlPlane.hosting = 'on-prem'
    plan.controlPlane.placement = 'own-rack'
    plan.controlPlane.rack.widthInches = 21
    const racks = deriveRackLayout(plan)[0].racks
    expect(racks.map((rack) => rack.slots.filter((slot) => slot.kind === 'power').length)).toEqual([
      2, 2, 4, 2, 2,
    ])
    expect(racks.every((rack) => rack.busBar?.label.includes('bus bar'))).toBe(true)
    const shelves = racks.flatMap((rack) => rack.slots.filter((slot) => slot.kind === 'power'))
    expect(shelves).toHaveLength(
      deriveBom(plan).find((line) => line.catalogId === 'power-orv3-shelf')!.quantity,
    )
    expect(shelves.every((slot) => slot.units === 1 && slot.powerWatts === 0)).toBe(true)
    expect(racks[2].powerWatts).toBe(33490)
    expect(
      racks[2].slots.filter((slot) => slot.kind === 'power').map((slot) => slot.label),
    ).toEqual(['Power shelf A1', 'Power shelf A2', 'Power shelf B1', 'Power shelf B2'])
  })

  it('keeps bus bars visible in empty ORV3 racks and omits infrastructure from EIA racks', () => {
    const plan = orv3Plan(0)
    const partition = plan.partitions[0]
    partition.racks[0].leafCount = 0
    partition.fabric.mgmt.leafPerRack = 0
    const [central, empty] = deriveRackLayout(plan)[0].racks
    expect(empty.busBar).toBeDefined()
    expect(empty.slots).toEqual([])
    expect(empty.usedU).toBe(0)
    expect(central.busBar).toBeUndefined()
    expect(central.slots.some((slot) => slot.kind === 'power')).toBe(false)
  })

  it('orders sleds, partial trays, CPUs and BMC links independently', () => {
    const plan = orv3Plan()
    const rack = plan.partitions[0].racks[0]
    const bom = deriveBom(plan)
    const qty = (id: string) => bom.find((line) => line.catalogId === id)?.quantity ?? 0
    expect(qty('server-gigabyte-to25-s12')).toBe(3)
    expect(qty('chassis-gigabyte-to25-bt0')).toBe(2)
    expect(qty('cpu-xeon-4509y')).toBe(3)
    expect(qty('mem-ddr5r-16g')).toBe(6)
    expect(qty('nic-e810-xxvda2')).toBe(3)
    expect(bom.filter((line) => line.category === 'drive')).toEqual([])
    expect(rackBmcPorts(rack)).toBe(3)
    const bmc = bom.find((line) => line.catalogId === 'cable-rj45')!
    expect(
      bmc.reasons.find(
        (reason) => reason.where.endsWith(rack.name) && reason.detail.includes('BMC'),
      )?.quantity,
    ).toBe(3)
    rack.servers[0].count = 0
    expect(deriveBom(plan).some((line) => line.catalogId === 'chassis-gigabyte-to25-bt0')).toBe(
      false,
    )
  })

  it('uses OU for two-node trays and keeps partial-tray power proportional', () => {
    const rack = deriveRackLayout(orv3Plan())[0].racks[1]
    expect(rack.widthInches).toBe(21)
    expect(rack.slots.filter((slot) => slot.kind === 'server').map((slot) => slot.units)).toEqual([
      2, 2,
    ])
    expect(rack.usedU).toBe(9) // 3 switch slots, two 2OU trays and two power shelves
    expect(
      rack.slots.filter((slot) => slot.kind === 'server').map((slot) => slot.powerWatts),
    ).toEqual([800, 400])
    expect(heightInRack('server-gigabyte-to25-s12', 19)).toBe(3)
  })

  it('preserves width while spreading trays across a rack group', () => {
    const plan = orv3Plan(6)
    const p = plan.partitions[0]
    p.racks[0] = withRackKind(p, p.racks[0], 'rack-group')
    const racks = deriveRackLayout(plan)[0].racks.slice(1)
    expect(racks.map((rack) => rack.widthInches)).toEqual([21, 21, 21])
    expect(racks.map((rack) => rack.slots.filter((slot) => slot.kind === 'server').length)).toEqual(
      [1, 1, 1],
    )
  })

  it('checks rack width after toggling without discarding server configuration', () => {
    const plan = orv3Plan()
    const rack = plan.partitions[0].racks[0]
    expect(validatePlan(plan).filter((issue) => issue.severity === 'error')).toEqual([])
    rack.widthInches = 19
    const mismatch = validatePlan(plan).find((issue) =>
      issue.message.includes('requires a 21″ rack'),
    )
    expect(mismatch?.severity).toBe('error')
    expect(mismatch?.target.rackId).toBe(rack.id)
    expect(mismatch?.target.field).toBe('advanced')
    expect(rack.servers[0].modelId).toBe('server-gigabyte-to25-s12')
    rack.widthInches = 21
    rack.heightUnits = 6
    expect(validatePlan(plan).some((issue) => issue.message.includes('9OU of 6OU'))).toBe(true)
  })

  it('counts each sled against management port capacity', () => {
    const plan = orv3Plan(48)
    expect(
      validatePlan(plan).some((issue) => issue.message.includes('50 1G ports needed for BMC')),
    ).toBe(true)
  })

  it('offers EIA and ORV3 models for ORV3 racks, and only EIA for 19-inch racks', () => {
    for (const usage of ['worker', 'storage'] as const) {
      expect(serversForUsage(usage, 21)).toEqual(serversForUsage(usage))
      expect(serversForUsage(usage, 21).map((item) => item.id)).toContain(
        'server-gigabyte-to25-s12',
      )
      expect(serversForUsage(usage, 19).every((item) => item.rackWidthInches !== 21)).toBe(true)
    }
    expect(catalog['server-gigabyte-to25-s12'].status).toBe('alpha')
  })

  it('seeds new racks and groups from partition format defaults', () => {
    const plan = createEmptyPlan()
    const p = plan.partitions[0]
    p.rackDefaults.widthInches = 21
    for (const kind of ['single', 'rack-group'] as const) {
      const rack = newRack(p, kind)
      expect(rack.widthInches).toBe(21)
      expect(rack.servers[0].modelId).toBe('server-gigabyte-to25-s12')
    }
    expect(p.racks[0].widthInches).toBe(19)
    usePlanStore.getState().replacePlan(orv3Plan())
    const state = usePlanStore.getState()
    const partition = state.plan.partitions[0]
    state.addServerGroup(partition.id, partition.racks[0].id)
    expect(usePlanStore.getState().plan.partitions[0].racks[0].servers[1].modelId).toBe(
      'server-gigabyte-to25-s12',
    )
  })

  it('round-trips widths for compute, central and control-plane racks', () => {
    const plan = orv3Plan()
    plan.partitions[0].rackDefaults.widthInches = 21
    plan.controlPlane.rack.widthInches = 21
    expect(importPlanJson(exportPlanJson(plan))).toEqual(plan)
    const raw = JSON.parse(exportPlanJson(plan))
    delete raw.partitions[0].racks[0].widthInches
    delete raw.partitions[0].rackDefaults.widthInches
    delete raw.controlPlane.rack.widthInches
    const old = importPlanJson(JSON.stringify(raw))
    expect(old.partitions[0].racks[0].widthInches).toBe(19)
    expect(old.partitions[0].rackDefaults.widthInches).toBe(19)
    expect(old.controlPlane.rack.widthInches).toBe(19)
  })

  it.each([20, '21', null])('rejects invalid rack widths: %s', (width) => {
    const raw = JSON.parse(exportPlanJson(orv3Plan()))
    raw.partitions[0].racks[0].widthInches = width
    expect(() => importPlanJson(JSON.stringify(raw))).toThrow('not a valid plan')
  })
})

describe('19-inch equipment in ORV3 racks', () => {
  function adapters(plan: ReturnType<typeof createEmptyPlan>, scope: BomScope = 'all') {
    return deriveBom(plan, scope).find((line) => line.catalogId === 'rack-adapter-19-to-21')
  }

  it('accepts EIA servers and estimates adapters by chassis height in a mixed rack', () => {
    const plan = orv3Plan()
    const rack = plan.partitions[0].racks[0]
    rack.servers.push({
      ...rack.servers[0],
      id: 'eia',
      modelId: 'server-microcloud-h13',
      count: 9,
    })
    expect(validatePlan(plan).filter((issue) => issue.severity === 'error')).toEqual([])
    // Two 3U MicroCloud chassis need two adapters each; the three switches
    // need one each. No adapters for
    // the three ORV3 sleds, their two trays, CPUs, NICs or drives.
    expect(adapters(plan)?.quantity).toBe(7)
    expect(adapters(plan, 'production')?.quantity).toBe(6)
    expect(adapters(plan, 'management')?.quantity).toBe(1)
    const serverReason = adapters(plan)?.reasons.find((reason) =>
      reason.detail.includes('AS-3015MR'),
    )
    expect(serverReason?.quantity).toBe(4)
    expect(serverReason?.where).toBe(rack.name)
    expect(serverReason?.detail).toContain('(3U)')
    expect(deriveBom(plan).some((line) => line.catalogId === 'rack-adapter-19-to-21#spare')).toBe(
      false,
    )
    const used = deriveRackLayout(plan)[0].racks[1].usedU
    expect(used).toBe(15) // 3 switch slots, 4OU of ORV3 trays, 6OU of EIA chassis, 2OU power
    rack.servers = rack.servers.filter((group) => group.id === 'eia')
    rack.widthInches = 19
    expect(adapters(plan)).toBeUndefined()
    rack.widthInches = 21
    expect(adapters(plan)?.quantity).toBe(7)
  })

  it('sizes adapters automatically per chassis, ignoring legacy rail-kit overrides', () => {
    const plan = createEmptyPlan()
    const rack = plan.partitions[0].racks[0]
    rack.widthInches = 21
    const group = rack.servers[0]
    group.count = 9 // Two 3U chassis, including a partially filled one.
    group.nodeConfigs = { 0: { sizeId: 'c1-medium-x86' } }
    expect(adapters(plan)?.quantity).toBe(7)
    const raw = JSON.parse(exportPlanJson(plan))
    raw.partitions[0].racks[0].servers[0].mountingAdaptersPerChassis = 1
    const imported = importPlanJson(JSON.stringify(raw))
    expect(adapters(imported)?.quantity).toBe(7)
    expect(adapters(imported, 'production')?.quantity).toBe(6)
    expect(adapters(imported, 'management')?.quantity).toBe(1)
    const reason = adapters(imported)?.reasons.find((r) => r.detail.includes('AS-3015MR-H8TNR'))
    expect(reason?.quantity).toBe(4)
    expect(reason?.detail).toContain('2 × AS-3015MR-H8TNR (3U) × 2 mounting adapters')
    expect(reason?.detail).toContain('(height estimate)')
    group.modelId = 'server-bigtwin-x12' // Three 2U chassis for nine nodes.
    expect(adapters(plan)?.quantity).toBe(9)
    group.modelId = 'server-gigabyte-to25-s12'
    expect(adapters(plan)?.quantity).toBe(3) // No mounting adapters for native ORV3 sleds.
    rack.widthInches = 19
    group.modelId = 'server-bigtwin-x12'
    expect(adapters(plan)).toBeUndefined()
  })

  it('counts shared switches only once when EIA chassis spread across a rack group', () => {
    const plan = createEmptyPlan()
    const partition = plan.partitions[0]
    const rack = partition.racks[0]
    rack.widthInches = 21
    rack.servers[0].count = 17 // Three chassis, even with a partial last one.
    partition.racks[0] = withRackKind(partition, rack, 'rack-group')
    expect(adapters(plan)?.quantity).toBe(9)
    expect(
      adapters(plan)?.reasons.every((reason) => reason.where === partition.racks[0].name),
    ).toBe(true)
    rack.servers[0].count = 0
    expect(adapters(plan)?.quantity).toBe(3)
    partition.racks[0].leafCount = 0
    partition.fabric.mgmt.leafPerRack = 0
    expect(adapters(plan)).toBeUndefined()
  })

  it('covers central routers, all switch tiers, management servers and hosted control-plane nodes', () => {
    const plan = createEmptyPlan()
    const partition = plan.partitions[0]
    partition.rackDefaults.widthInches = 21
    partition.fabric.fabricType = 'leaf-spine-superspine'
    partition.fabric.superspineCount = 2
    partition.fabric.storageLeafCount = 3
    plan.controlPlane.hosting = 'on-prem'
    // 2 routers + 2 exits + 2 spines + 2 superspines + 3 storage leaves
    // + 2 mgmt spines + 2 mgmt servers + 3 control-plane nodes.
    expect(adapters(plan)?.quantity).toBe(18)
    expect(adapters(plan, 'production')?.quantity).toBe(14)
    expect(adapters(plan, 'management')?.quantity).toBe(4)
    expect(adapters(plan)?.reasons.every((reason) => reason.where === 'Central rack')).toBe(true)
    expect(
      adapters(plan)?.reasons.some((reason) => reason.detail.includes('router-internet')),
    ).toBe(true)
    // The same server model occurs in both networks; both contributions count.
    expect(
      adapters(plan)
        ?.reasons.filter((reason) => reason.detail.includes('SYS-121H-TNR'))
        .map((reason) => reason.quantity),
    ).toEqual([2, 3])
    plan.controlPlane.nodeCount = 0
    expect(adapters(plan)?.quantity).toBe(15)
    partition.fabric.fabricType = 'leaf-spine'
    expect(adapters(plan)?.quantity).toBe(13)
  })

  it('uses the separate control-plane rack format and counts it only in its host partition', () => {
    const plan = createEmptyPlan()
    plan.partitions.push(defaultPartition('Partition 2'))
    const cp = plan.controlPlane
    cp.hosting = 'on-prem'
    cp.placement = 'own-rack'
    cp.partitionId = plan.partitions[1].id
    cp.rack.widthInches = 21
    expect(adapters(plan)?.quantity).toBe(6) // 3 nodes, 2 leaves, 1 mgmt leaf
    expect(adapters(plan, 'production')?.quantity).toBe(5)
    expect(adapters(plan, 'management')?.quantity).toBe(1)
    expect(
      adapters(plan)?.reasons.every((reason) => reason.where === `Partition 2 - ${cp.rack.name}`),
    ).toBe(true)
    const byPartition = deriveBomByPartition(plan)
    expect(byPartition[0].lines.some((line) => line.catalogId === 'rack-adapter-19-to-21')).toBe(
      false,
    )
    expect(
      byPartition[1].lines.find((line) => line.catalogId === 'rack-adapter-19-to-21')?.quantity,
    ).toBe(6)
    cp.rack.widthInches = 19
    expect(adapters(plan)).toBeUndefined()
    cp.rack.widthInches = 21
    cp.hosting = 'kaas'
    expect(adapters(plan)).toBeUndefined()
  })
})
