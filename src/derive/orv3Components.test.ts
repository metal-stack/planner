import { describe, expect, it } from 'vitest'
import { catalog, cpusForServer, dimmsForServer, driveOptions } from '../model/catalog'
import { createEmptyPlan } from '../model/defaults'
import { exportPlanJson, importPlanJson } from '../io/json'
import { deriveBom } from './bom'
import { validatePlan } from './validate'

function sledPlan(modelId = 'server-gigabyte-to25-z12') {
  const plan = createEmptyPlan()
  const rack = plan.partitions[0].racks[0]
  rack.widthInches = 21
  rack.servers[0].modelId = modelId
  rack.servers[0].count = 3 // Two trays, but three CPUs and boot adapters.
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

describe('ORv3 sled components', () => {
  it.each([
    ['n1-medium-x86', 'cpu-epyc-9015', 'mem-ddr5r-16g', 6],
    ['c1-medium-x86', 'cpu-epyc-9015', 'mem-ddr5r-32g', 12],
    ['c1-large-x86', 'cpu-epyc-9254', 'mem-ddr5r-32g', 18],
  ])('orders AMD CPU, RAM and storage for %s per node', (sizeId, cpu, memory, dimms) => {
    const plan = sledPlan()
    plan.partitions[0].racks[0].servers[0].sizeId = sizeId
    expect(quantities(plan)).toMatchObject({
      [cpu]: 3,
      [memory]: dimms,
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

  it('offers only SP5 CPUs, RDIMMs and the sled-specific drive interfaces', () => {
    const amd = 'server-gigabyte-to25-z12'
    const intel = 'server-gigabyte-to25-s12'
    expect(cpusForServer(amd).map((item) => item.id)).toEqual(['cpu-epyc-9015', 'cpu-epyc-9254'])
    expect(dimmsForServer(amd).every((item) => item.dimmType === 'ddr5-rdimm')).toBe(true)
    expect(driveOptions(amd).map((item) => item.id)).toEqual([
      'drive-m2-480',
      'drive-e1s-1920',
      'drive-e1s-3840',
    ])
    expect(driveOptions(intel).map((item) => item.id)).toEqual([
      'drive-m2-sata-480',
      'drive-e1s-1920',
      'drive-e1s-3840',
    ])
  })

  it('counts custom components by occupied sled positions and survives export/import', () => {
    const plan = sledPlan()
    const group = plan.partitions[0].racks[0].servers[0]
    group.nodeConfigs = {
      0: {
        sizeId: group.sizeId,
        compute: { cpuModelId: 'cpu-epyc-9254', dimmModelId: 'mem-ddr5r-32g', dimmsPerNode: 12 },
        drives: [{ modelId: 'drive-e1s-3840', perNode: 4 }],
      },
    }
    const imported = importPlanJson(exportPlanJson(plan))
    expect(quantities(imported)).toMatchObject({
      'cpu-epyc-9254': 2,
      'cpu-epyc-9015': 1,
      'mem-ddr5r-32g': 24,
      'mem-ddr5r-16g': 2,
      'drive-e1s-3840': 8,
      'drive-e1s-1920': 1,
      'drive-m2-480': 1,
      'adapter-gigabyte-cmtp192': 1,
    })
    expect(errors(imported)).toEqual([])
  })

  it.each(['server-gigabyte-to25-s12', 'server-gigabyte-to25-z12'])(
    'preserves explicitly empty drives on %s',
    (modelId) => {
      const plan = sledPlan(modelId)
      plan.partitions[0].racks[0].servers[0].drives = []
      const imported = importPlanJson(exportPlanJson(plan))
      expect(deriveBom(imported).filter((line) => line.category === 'drive')).toEqual([])
      expect(quantities(imported)['adapter-gigabyte-cmtp192']).toBeUndefined()
      expect(
        validatePlan(imported).some((issue) => issue.message.includes('no drives configured')),
      ).toBe(true)
    },
  )

  it('validates AMD socket, memory technology and the twelve-DIMM limit', () => {
    const plan = sledPlan()
    const group = plan.partitions[0].racks[0].servers[0]
    group.compute = { cpuModelId: 'cpu-epyc-4344p', dimmModelId: 'mem-ddr5u-32g', dimmsPerNode: 13 }
    const messages = errors(plan).join('\n')
    expect(messages).toContain('SP5')
    expect(messages).toContain('RDIMM')
    expect(messages).toContain('12')
    expect(messages).toContain('13')
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
