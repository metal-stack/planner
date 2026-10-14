import { describe, expect, it } from 'vitest'
import { createEmptyPlan, defaultPartition, newRack, withRackKind } from '../model/defaults'
import { catalog, heightInRack, serversForUsage } from '../model/catalog'
import { exportPlanJson, importPlanJson } from '../io/json'
import { usePlanStore } from '../store/planStore'
import { deriveBom, deriveBomByPartition, rackBmcPorts, type BomScope } from './bom'
import { deriveRackLayout } from './rackLayout'
import { validatePlan } from './validate'

function orv3Plan(count = 3) {
  const plan = createEmptyPlan()
  const rack = plan.partitions[0].racks[0]
  rack.widthInches = 21
  rack.servers[0].modelId = 'server-gigabyte-to25-s12'
  rack.servers[0].count = count
  return plan
}

describe('ORV3 racks', () => {
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
    expect(rack.usedU).toBe(7) // 3 switch slots plus two 2OU trays
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
    expect(validatePlan(plan).some((issue) => issue.message.includes('7OU of 6OU'))).toBe(true)
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
    expect(used).toBe(13) // 3 switch slots, 4OU of ORV3 trays, 6OU of EIA chassis
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
