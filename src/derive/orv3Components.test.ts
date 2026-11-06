import { describe, expect, it } from 'vitest'
import { catalog, cpusForServer } from '../model/catalog'
import { createEmptyPlan } from '../model/defaults'
import { exportPlanJson, importPlanJson } from '../io/json'
import { deriveBom } from './bom'
import { validatePlan } from './validate'

function sledPlan(modelId = 'server-gigabyte-to25-z12') {
  const plan = createEmptyPlan()
  const rack = plan.partitions[0].racks[0]
  rack.widthInches = 21
  rack.servers[0].modelId = modelId
  rack.servers[0].count = 3
  return plan
}

function quantities(plan: ReturnType<typeof sledPlan>) {
  return Object.fromEntries(deriveBom(plan).map((line) => [line.catalogId, line.quantity]))
}

function errors(plan: ReturnType<typeof sledPlan>) {
  return validatePlan(plan)
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.message)
}

function warnings(plan: ReturnType<typeof sledPlan>) {
  return validatePlan(plan)
    .filter((issue) => issue.severity === 'warning')
    .map((issue) => issue.message)
}

describe('ORv3 sled components', () => {
  it('orders AMD CPU, RAM and storage per node, with shared trays', () => {
    const plan = sledPlan()
    expect(quantities(plan)).toMatchObject({
      'cpu-epyc-9015': 3,
      'mem-ddr5r-16g': 6,
      'chassis-gigabyte-to25-bt0': 2,
      'drive-m2-480': 3,
      'drive-e1s-1920': 3,
      'adapter-gigabyte-cmtp192': 3,
      'rack-adapter-19-to-21': 3, // Switches only; the internal card needs no rack kit.
    })
    expect(errors(plan)).toEqual([])
    expect(
      validatePlan(plan).some((issue) => /not modeled|no drives configured/.test(issue.message)),
    ).toBe(false)
  })

  it.each([
    ['server-gigabyte-to25-s12', 'cpu-xeon-6542y', 250],
    ['server-gigabyte-to25-z12', 'cpu-epyc-9254', 240],
  ] as const)(
    'filters and validates CPU TDP on %s, including per-position overrides',
    (modelId, cpuId, limit) => {
      const original = catalog[cpuId]
      const plan = sledPlan(modelId)
      const group = plan.partitions[0].racks[0].servers[0]
      group.nodeConfigs = { 1: { sizeId: group.sizeId, compute: { cpuModelId: cpuId } } }
      try {
        catalog[cpuId] = { ...original, powerWatts: limit }
        expect(cpusForServer(modelId).map((cpu) => cpu.id)).toContain(cpuId)
        expect(errors(plan)).toEqual([])

        catalog[cpuId] = { ...original, powerWatts: limit + 1 }
        expect(cpusForServer(modelId).map((cpu) => cpu.id)).not.toContain(cpuId)
        expect(errors(plan)).toContain(
          `Chassis position 2: ${original.model} has a stock TDP of ${limit + 1} W, but ${catalog[modelId].model} supports CPUs up to ${limit} W.`,
        )
      } finally {
        catalog[cpuId] = original
      }
    },
  )

  it.each(['server-gigabyte-to25-s12', 'server-gigabyte-to25-z12'])(
    'accepts DIMM counts within slot capacity and faster-rated RDIMMs on %s',
    (modelId) => {
      const plan = sledPlan(modelId)
      const group = plan.partitions[0].racks[0].servers[0]
      group.compute = { dimmModelId: 'mem-ddr5r-6400-16g', dimmsPerNode: 3 }
      expect(warnings(plan).filter((message) => /DIMM|RDIMM/.test(message))).toEqual([])
      expect(errors(plan)).toEqual([])
      group.compute.dimmsPerNode = 4
      expect(warnings(plan).filter((message) => /DIMM|RDIMM/.test(message))).toEqual([])
      expect(errors(plan)).toEqual([])
    },
  )

  it('reports AMD revision qualification for the effective chassis-position CPU', () => {
    const plan = sledPlan()
    const group = plan.partitions[0].racks[0].servers[0]
    group.sizeId = 'c1-large-x86'
    expect(warnings(plan).some((message) => message.includes('EPYC 9005-qualified'))).toBe(false)
    group.nodeConfigs = { 1: { sizeId: 'n1-medium-x86' } }
    expect(warnings(plan)).toContain(
      `Chassis position 2: ${catalog[group.modelId].cpuCompatibilityNotes!['cpu-epyc-9015']}`,
    )
  })

  it('reports Intel 24 GB RAM qualification for the effective chassis-position DIMM', () => {
    const plan = sledPlan('server-gigabyte-to25-s12')
    const group = plan.partitions[0].racks[0].servers[0]
    group.nodeConfigs = {
      1: { sizeId: 'c1-large-x86', compute: { dimmModelId: 'mem-ddr5r-24g', dimmsPerNode: 8 } },
    }
    expect(warnings(plan)).toContain(
      `Chassis position 2: ${catalog[group.modelId].dimmCompatibilityNotes!['mem-ddr5r-24g']}`,
    )
    group.nodeConfigs[1].compute!.dimmModelId = 'mem-ddr5r-32g'
    expect(warnings(plan).some((message) => message.includes('24 Gbit'))).toBe(false)
  })

  it('round-trips drive overrides and counts adapters only for occupied sled positions', () => {
    const plan = sledPlan()
    const group = plan.partitions[0].racks[0].servers[0]
    group.drives = []
    group.nodeConfigs = {
      0: {
        sizeId: group.sizeId,
        drives: [
          { modelId: 'drive-m2-480', perNode: 1 },
          { modelId: 'drive-e1s-3840', perNode: 4 },
        ],
      },
    }
    const imported = importPlanJson(exportPlanJson(plan))
    expect(quantities(imported)).toMatchObject({
      'drive-e1s-3840': 8,
      'drive-m2-480': 2,
      'adapter-gigabyte-cmtp192': 2,
    })
    expect(errors(imported)).toEqual([])
  })

  it('omits drives and their adapter when the drive list is explicitly empty', () => {
    const plan = sledPlan()
    plan.partitions[0].racks[0].servers[0].drives = []
    expect(deriveBom(plan).filter((line) => line.category === 'drive')).toEqual([])
    expect(quantities(plan)['adapter-gigabyte-cmtp192']).toBeUndefined()
    expect(warnings(plan).some((message) => message.includes('no drives configured'))).toBe(true)
  })

  it('accepts twelve AMD DIMMs and rejects a thirteenth', () => {
    const plan = sledPlan()
    const group = plan.partitions[0].racks[0].servers[0]
    group.compute = { dimmsPerNode: 12 }
    expect(errors(plan)).toEqual([])
    group.compute.dimmsPerNode = 13
    expect(errors(plan)).toContain(
      'TO25-Z12-AA01 supports 12 DIMM slots per CPU: 12 available, 13 configured.',
    )
  })

  it.each([
    ['server-gigabyte-to25-s12', 'drive-m2-480'],
    ['server-gigabyte-to25-z12', 'drive-m2-sata-480'],
    ['server-gigabyte-to25-z12', 'drive-nvme-960'],
  ])('rejects incompatible %s drive %s', (modelId, drive) => {
    const plan = sledPlan(modelId)
    plan.partitions[0].racks[0].servers[0].drives = [{ modelId: drive, perNode: 1 }]
    expect(errors(plan)).toContain(
      `${catalog[drive].description} does not fit ${catalog[modelId].model} drive bays.`,
    )
  })

  it.each([
    ['server-gigabyte-to25-s12', 2],
    ['server-gigabyte-to25-z12', 4],
  ])('sums E1.S occupancy across different drive rows for %s', (modelId, bays) => {
    const plan = sledPlan(modelId)
    const group = plan.partitions[0].racks[0].servers[0]
    group.drives = [
      { modelId: 'drive-e1s-1920', perNode: bays - 1 },
      { modelId: 'drive-e1s-3840', perNode: 1 },
    ]
    expect(errors(plan)).toEqual([])
    group.drives[1].perNode = 2
    expect(errors(plan)).toContain(
      `${catalog[modelId].model} has ${bays} E1.S bays per node, but ${bays + 1} drives are configured.`,
    )
  })

  it('flags duplicate M.2 rows and counts one card per node', () => {
    const plan = sledPlan()
    plan.partitions[0].racks[0].servers[0].drives = [
      { modelId: 'drive-m2-480', perNode: 1 },
      { modelId: 'drive-m2-480', perNode: 1 },
    ]
    expect(errors(plan)).toContain(
      'TO25-Z12-AA01 has 1 M.2 bays per node, but 2 drives are configured.',
    )
    expect(quantities(plan)['adapter-gigabyte-cmtp192']).toBe(3)
  })
})
