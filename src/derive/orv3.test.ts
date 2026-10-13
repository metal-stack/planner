import { describe, expect, it } from 'vitest'
import { createEmptyPlan, newRack, withRackKind } from '../model/defaults'
import { catalog, heightInRack, serversForUsage } from '../model/catalog'
import { exportPlanJson, importPlanJson } from '../io/json'
import { usePlanStore } from '../store/planStore'
import { deriveBom, rackBmcPorts } from './bom'
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

  it('offers native server models for each format and supported role', () => {
    for (const usage of ['worker', 'storage'] as const) {
      expect(serversForUsage(usage, 21).map((item) => item.id)).toEqual([
        'server-gigabyte-to25-s12',
        'server-gigabyte-to25-z12',
      ])
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
