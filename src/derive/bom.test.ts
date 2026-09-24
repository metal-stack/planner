import { describe, expect, it } from 'vitest'
import { createEmptyPlan, defaultPartition, defaultRack } from '../model/defaults'
import type { Plan, ServerGroup } from '../model/plan'
import {
  chassisCount,
  deriveBom,
  deriveBomByPartition,
  formatReasons,
  mgmtUplinkSpeed,
  reasonsByWhere,
  SPARE_CATEGORY,
} from './bom'

function planWithWorkers(count: number, uplink: ServerGroup['uplink']): Plan {
  return planWithServer('server-microcloud-x11', count, uplink)
}

function planWithServer(
  modelId: string,
  count: number,
  uplink: ServerGroup['uplink'] = '2x25G',
): Plan {
  const plan = createEmptyPlan()
  const rack = defaultRack('Rack 1')
  rack.servers = [
    {
      id: 'g1',
      role: 'worker',
      modelId,
      count,
      uplink,
      sizeId: 'n1-medium-x86',
      nodeConfigs: {},
    },
  ]
  plan.partitions[0].racks = [rack]
  return plan
}

function quantity(plan: Plan, catalogId: string): number {
  return deriveBom(plan).find((l) => l.catalogId === catalogId)?.quantity ?? 0
}

/** Quantity attributable to the servers alone: the plan minus the same
 *  plan with an empty rack (fabric and management cabling stay constant). */
function serverQuantity(plan: Plan, catalogId: string): number {
  const empty = structuredClone(plan)
  empty.partitions[0].racks[0].servers = []
  return quantity(plan, catalogId) - quantity(empty, catalogId)
}

describe('chassisCount', () => {
  it('divides nodes by nodes-per-chassis, rounding up', () => {
    const group: ServerGroup = {
      id: 'g',
      role: 'worker',
      modelId: 'server-microcloud-x11', // 8 nodes per chassis
      count: 9,
      uplink: '2x25G',
      sizeId: 'n1-medium-x86',
      nodeConfigs: {},
    }
    expect(chassisCount(group)).toBe(2)
  })
})

describe('deriveBom NIC rules', () => {
  it('selects one dual-port 25G NIC per node for 2x25G groups', () => {
    const plan = planWithWorkers(16, '2x25G')
    expect(quantity(plan, 'nic-e810-xxvda2')).toBe(16)
    expect(quantity(plan, 'nic-e810-cqda2')).toBe(0)
  })

  it('selects one dual-port 100G NIC per node for 2x100G groups', () => {
    const plan = planWithWorkers(4, '2x100G')
    expect(quantity(plan, 'nic-e810-cqda2')).toBe(4)
    expect(quantity(plan, 'nic-e810-xxvda2')).toBe(0)
  })

  it('uses an explicit NIC without changing uplink cabling', () => {
    const plan = planWithWorkers(4, '2x25G')
    plan.partitions[0].racks[0].servers[0].nicModelId = 'nic-connectx5'
    expect(quantity(plan, 'nic-connectx5')).toBe(4)
    expect(quantity(plan, 'nic-e810-xxvda2')).toBe(0)
    expect(serverQuantity(plan, 'sfp-25g-sr')).toBe(8)
    expect(serverQuantity(plan, 'cable-mtp-breakout')).toBe(2)
  })
})

describe('deriveBom node size rules', () => {
  it('adds one board-specific CPU and the preset DIMMs per node', () => {
    const h13 = planWithServer('server-microcloud-h13', 8)
    expect(quantity(h13, 'cpu-epyc-4344p')).toBe(8)
    expect(quantity(h13, 'mem-ddr5u-16g')).toBe(16)
    expect(
      deriveBom(h13).find((line) => line.catalogId === 'cpu-epyc-4344p')?.reasons[0].detail,
    ).toBe('8 worker nodes × 1 CPU (n1-medium-x86)')
    expect(
      deriveBom(h13).find((line) => line.catalogId === 'mem-ddr5u-16g')?.reasons[0].detail,
    ).toBe('8 worker nodes × 2 DIMMs (n1-medium-x86)')

    const x13 = planWithServer('server-microcloud-x13', 3)
    expect(quantity(x13, 'cpu-xeon-e2488')).toBe(3)
    expect(quantity(x13, 'mem-ddr5u-16g')).toBe(6)
  })

  it('marks custom parts in the reason and applies their quantity', () => {
    const plan = planWithServer('server-microcloud-h13', 4)
    plan.partitions[0].racks[0].servers[0].compute = {
      dimmModelId: 'mem-ddr5u-32g',
      dimmsPerNode: 4,
    }
    const line = deriveBom(plan).find((item) => item.catalogId === 'mem-ddr5u-32g')
    expect(line?.quantity).toBe(16)
    expect(line?.reasons[0].detail).toBe('4 worker nodes × 4 DIMMs (n1-medium-x86, customized)')
  })

  it('does not add CPU or DIMM lines for a socketless board', () => {
    const plan = planWithWorkers(8, '2x25G')
    expect(deriveBom(plan).some((line) => line.category === 'cpu')).toBe(false)
    expect(deriveBom(plan).some((line) => line.category === 'memory')).toBe(false)
  })
})

describe('deriveBom breakout math (2x25G)', () => {
  it('computes server transceivers, leaf 100G transceivers, and breakout cables', () => {
    // 10 nodes x 2 ports = 20x 25G server ports
    const plan = planWithWorkers(10, '2x25G')
    expect(serverQuantity(plan, 'sfp-25g-sr')).toBe(20)
    // 20 ports / 4 per breakout = 5 leaf-side 100G ports
    expect(serverQuantity(plan, 'sfp-100g-sr4')).toBe(5)
    expect(serverQuantity(plan, 'cable-mtp-breakout')).toBe(5)
  })

  it('rounds leaf-side ports up to a started breakout group', () => {
    // 3 nodes x 2 ports = 6 ports -> ceil(6/4) = 2
    const plan = planWithWorkers(3, '2x25G')
    expect(serverQuantity(plan, 'sfp-100g-sr4')).toBe(2)
    expect(serverQuantity(plan, 'cable-mtp-breakout')).toBe(2)
  })
})

describe('deriveBom 100G point-to-point (2x100G)', () => {
  it('uses a transceiver on each end and one trunk cable per link', () => {
    // 4 nodes x 2 ports = 8 links
    const plan = planWithWorkers(4, '2x100G')
    expect(serverQuantity(plan, 'sfp-100g-sr4')).toBe(16)
    expect(serverQuantity(plan, 'cable-mtp-trunk')).toBe(8)
    expect(serverQuantity(plan, 'cable-mtp-breakout')).toBe(0)
  })
})

describe('deriveBom switches', () => {
  it('counts fabric and per-rack switches for the default plan', () => {
    const plan = createEmptyPlan()
    // 2 spines + 2 exits + 2 leaves (all AS7726 in the defaults)
    expect(quantity(plan, 'switch-as7726')).toBe(6)
    // 2 mgmt spines (redundant) + 1 mgmt leaf per rack, no OOB switch
    expect(quantity(plan, 'switch-as4630')).toBe(3)
    // 2 mgmt servers (redundant) in the central rack
    expect(quantity(plan, 'server-mgmt-121h')).toBe(2)
  })
})

describe('deriveBom fabric extensions', () => {
  it('includes storage leaves and superspines only when configured', () => {
    const plan = createEmptyPlan()
    const fabric = plan.partitions[0].fabric
    fabric.storageLeafCount = 2
    fabric.superspineCount = 4 // ignored: fabricType is leaf-spine
    // default plan already has 6x AS7726 (2 spines + 2 exits + 2 leaves)
    expect(quantity(plan, 'switch-as7726')).toBe(8)

    fabric.fabricType = 'leaf-spine-superspine'
    expect(quantity(plan, 'switch-as7726')).toBe(12)
  })
})

describe('deriveBom fabric cabling', () => {
  it('cables every leaf, exit, superspine and storage leaf once to every spine', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].racks[0].servers = []
    // (2 leaves + 2 exits) x 2 spines = 8 fabric links + 2 routers x 2 exits x 2 = 8
    expect(quantity(plan, 'cable-mtp-trunk')).toBe(16)
    expect(quantity(plan, 'sfp-100g-sr4')).toBe(32)
    expect(quantity(plan, 'router-internet')).toBe(2)

    const fabric = plan.partitions[0].fabric
    fabric.storageLeafCount = 1
    fabric.fabricType = 'leaf-spine-superspine'
    fabric.superspineCount = 2
    // (2 leaves + 2 exits + 2 superspines + 1 storage leaf) x 2 spines = 14 + 8 router links
    expect(quantity(plan, 'cable-mtp-trunk')).toBe(22)
    plan.partitions[0].fabric.routerCount = 0
    expect(quantity(plan, 'cable-mtp-trunk')).toBe(14)
    // Two links per leaf-spine pair: 2 leaves x 2 spines x 2 = 8 instead of 4
    plan.partitions[0].fabric.leafSpineLinks = 2
    expect(quantity(plan, 'cable-mtp-trunk')).toBe(18)
  })
})

describe('deriveBom management cabling', () => {
  it('counts copper per chassis for BMCs, leaf and central-rack OOB links, and mgmt servers', () => {
    const plan = createEmptyPlan()
    // 1 chassis (8 nodes) BMC + 2 leaves × 1 mgmt interface
    // + (2 spines + 2 exits + 2 routers) × 1 mgmt interface
    // + 2 mgmt servers x 2 mgmt spines
    expect(quantity(plan, 'cable-rj45')).toBe(1 + 2 + 6 + 4)
    // 9 nodes -> 2 chassis
    plan.partitions[0].racks[0].servers[0].count = 9
    expect(quantity(plan, 'cable-rj45')).toBe(2 + 2 + 6 + 4)
  })

  it('halves the mgmt server links for a non-redundant management network', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].fabric.mgmt.redundant = false
    // 1 + 2 + 6 + 1 x 1
    expect(quantity(plan, 'cable-rj45')).toBe(10)
  })

  it('uplinks every mgmt leaf to every mgmt spine over 25G fiber', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].racks[0].servers = []
    // 1 mgmt leaf x 2 mgmt spines, AS4630 on both ends
    expect(quantity(plan, 'cable-lc-duplex')).toBe(2)
    expect(quantity(plan, 'sfp-25g-sr')).toBe(4)
    expect(quantity(plan, 'sfp-10g-sr')).toBe(0)
  })

  it('falls back to 10G fiber when a mgmt switch has no 25G ports', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].racks[0].servers = []
    plan.partitions[0].fabric.mgmt.spineModelId = 'switch-as4625'
    expect(mgmtUplinkSpeed('switch-as4630', 'switch-as4625')).toBe('10G')
    expect(quantity(plan, 'sfp-10g-sr')).toBe(4)
    expect(quantity(plan, 'sfp-25g-sr')).toBe(0)
  })
})

describe('deriveBom licenses', () => {
  it('adds one NOS license per switch by platform, for the default NOS', () => {
    const plan = createEmptyPlan()
    expect(plan.partitions[0].fabric.nos).toBe('broadcom-sonic')
    // 2 spines + 2 exits + 2 leaves on AS7726 -> 100G platform
    expect(quantity(plan, 'lic-sonic-eb-100g')).toBe(6)
    // 2 mgmt spines + 1 mgmt leaf on AS4630 -> 10G platform
    expect(quantity(plan, 'lic-sonic-eb-10g')).toBe(3)
    // The other distribution's licenses are not ordered.
    expect(quantity(plan, 'lic-sonic-100g')).toBe(0)
    expect(quantity(plan, 'lic-sonic-25g')).toBe(0)
  })

  it('swaps the whole license set when the partition picks another NOS', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].fabric.nos = 'edgecore-sonic'
    expect(quantity(plan, 'lic-sonic-100g')).toBe(6)
    expect(quantity(plan, 'lic-sonic-25g')).toBe(3)
    expect(quantity(plan, 'lic-sonic-eb-100g')).toBe(0)
    expect(quantity(plan, 'lic-sonic-eb-10g')).toBe(0)
  })

  it('names the NOS in the reason, so the license line explains itself', () => {
    const plan = createEmptyPlan()
    const line = deriveBom(plan).find((l) => l.catalogId === 'lic-sonic-eb-100g')
    expect(line?.reasons).toContainEqual({
      quantity: 2,
      detail: '2 × AS7726-32X, 1 Broadcom Enterprise SONiC license per switch',
      where: 'Central rack',
    })
  })

  it('licenses each partition under its own NOS', () => {
    const plan = createEmptyPlan()
    plan.partitions.push({
      ...structuredClone(plan.partitions[0]),
      id: 'p2',
      name: 'Partition 2',
    })
    plan.partitions[1].fabric.nos = 'edgecore-sonic'
    expect(quantity(plan, 'lic-sonic-eb-100g')).toBe(6)
    expect(quantity(plan, 'lic-sonic-100g')).toBe(6)
  })
})

describe('deriveBom reasons, spares and partition scope', () => {
  it('records one reason per contributing rule', () => {
    const plan = createEmptyPlan()
    const rj45 = deriveBom(plan).find((l) => l.catalogId === 'cable-rj45')!
    expect(rj45.reasons).toHaveLength(4)
    expect(rj45.reasons[0]).toEqual({
      quantity: 6,
      detail: '6 switches and routers × 1 mgmt interface to the mgmt spines',
      where: 'Central rack',
    })
    const sr4 = deriveBom(plan).find((l) => l.catalogId === 'sfp-100g-sr4')!
    // 16 fabric and 16 router link ends from the central rack, then the 4
    // leaf-side breakout ports (16 × 25G / 4) of the rack.
    expect(sr4.reasons.map((r) => r.quantity)).toEqual([16, 16, 4])
    expect(sr4.reasons.map((r) => r.where)).toEqual(['Central rack', 'Central rack', 'Rack 1'])
  })

  it('sections reasons by central rack and rack, unprefixed for one partition', () => {
    const plan = createEmptyPlan()
    const rj45 = deriveBom(plan).find((l) => l.catalogId === 'cable-rj45')!
    expect(rj45.reasons.map((r) => r.where)).toEqual([
      'Central rack',
      'Central rack',
      'Rack 1',
      'Rack 1',
    ])
  })

  it('names the partition in the section for multi-partition plans', () => {
    const plan = createEmptyPlan()
    plan.partitions.push(defaultPartition('Partition 2'))
    const spines = deriveBom(plan).find((l) => l.catalogId === 'switch-as7726')!
    expect(spines.reasons).toContainEqual({
      quantity: 2,
      detail: '2 spines',
      where: 'Partition 2 - Central rack',
    })
  })

  it('orders sections central rack first, then racks, per partition', () => {
    const plan = createEmptyPlan()
    plan.partitions.push(defaultPartition('Partition 2'))
    plan.partitions[0].racks.push(defaultRack('Rack 2'))
    const rj45 = deriveBom(plan).find((l) => l.catalogId === 'cable-rj45')!
    expect(reasonsByWhere(rj45.reasons).map((g) => g.where)).toEqual([
      'Partition 1 - Central rack',
      'Partition 1 - Rack 1',
      'Partition 1 - Rack 2',
      'Partition 2 - Central rack',
      'Partition 2 - Rack 1',
    ])
  })

  it('puts the central rack first for a production line too', () => {
    // Derivation order is canonical, so every line reads the same way round
    // rather than depending on which rule happened to fire first.
    const plan = createEmptyPlan()
    plan.partitions[0].racks.push(defaultRack('Rack 2'))
    const sr4 = deriveBom(plan).find((l) => l.catalogId === 'sfp-100g-sr4')!
    expect(reasonsByWhere(sr4.reasons).map((g) => g.where)).toEqual([
      'Central rack',
      'Rack 1',
      'Rack 2',
    ])
  })

  it('formats a reason for the exports without a long dash', () => {
    const plan = createEmptyPlan()
    const rj45 = deriveBom(plan).find((l) => l.catalogId === 'cable-rj45')!
    const text = formatReasons(rj45.reasons)
    expect(text).toContain('Rack 1: 1 (1 server chassis × 1 BMC port to the mgmt leaf)')
    expect(text).not.toMatch(/[—–]/)
  })

  it('leaves plan-wide reasons unsectioned', () => {
    const plan = createEmptyPlan()
    const spare = deriveBom(plan).find((l) => l.category === SPARE_CATEGORY)!
    expect(spare.reasons[0].where).toBe('')
    expect(formatReasons(spare.reasons)).toBe('2 (fixed spares per transceiver/cable line)')
  })

  it('adds a fixed number of spares per transceiver and cable line', () => {
    const plan = createEmptyPlan()
    const lines = deriveBom(plan)
    const sources = lines.filter((l) => l.category === 'transceiver' || l.category === 'cable')
    const spares = lines.filter((l) => l.category === SPARE_CATEGORY)
    expect(spares).toHaveLength(sources.length)
    expect(spares.every((l) => l.quantity === 2)).toBe(true)
    plan.sparesPerLine = 0
    expect(deriveBom(plan).some((l) => l.category === SPARE_CATEGORY)).toBe(false)
  })

  it('derives per-partition BOMs without spares that add up to the plan BOM', () => {
    const plan = createEmptyPlan()
    plan.partitions.push(defaultPartition('Partition 2'))
    const perPartition = deriveBomByPartition(plan)
    expect(perPartition.map((b) => b.partition.name)).toEqual(['Partition 1', 'Partition 2'])
    const total = deriveBom(plan).filter((l) => l.category !== SPARE_CATEGORY)
    for (const line of total) {
      const sum = perPartition.reduce(
        (n, b) => n + (b.lines.find((l) => l.catalogId === line.catalogId)?.quantity ?? 0),
        0,
      )
      expect(sum).toBe(line.quantity)
    }
    expect(perPartition[0].lines.some((l) => l.category === SPARE_CATEGORY)).toBe(false)
  })
})

describe('deriveBom GPUs', () => {
  function planWithGpu(perNode: number, nodes = 8): Plan {
    const plan = planWithWorkers(nodes, '2x25G')
    const group = plan.partitions[0].racks[0].servers[0]
    group.modelId = 'server-microcloud-x13'
    group.gpu = { modelId: 'gpu-rtx-6000-ada', perNode }
    return plan
  }

  it('orders nodes × perNode GPUs', () => {
    expect(quantity(planWithGpu(1), 'gpu-rtx-6000-ada')).toBe(8)
    expect(quantity(planWithGpu(2, 4), 'gpu-rtx-6000-ada')).toBe(8)
  })

  it('orders none when no GPU is configured', () => {
    expect(quantity(planWithWorkers(8, '2x25G'), 'gpu-rtx-6000-ada')).toBe(0)
  })

  it('explains the quantity and carries vendor and model', () => {
    const line = deriveBom(planWithGpu(1)).find((l) => l.catalogId === 'gpu-rtx-6000-ada')
    expect(line?.reasons).toEqual([
      { quantity: 8, detail: '8 worker nodes × 1 GPU', where: 'Rack 1' },
    ])
    expect(line).toMatchObject({ vendor: 'NVIDIA', model: 'RTX 6000 Ada', category: 'gpu' })
  })

  it('names devices by model rather than ordering code in reasons', () => {
    const line = deriveBom(planWithWorkers(8, '2x25G')).find(
      (l) => l.catalogId === 'lic-sonic-eb-100g',
    )
    expect(formatReasons(line!.reasons)).toContain('AS7726-32X')
  })
})

describe('deriveBom per-position node configurations', () => {
  // Two chassis: a position's configuration applies to that node in both.
  function planWithNodeConfigs(): Plan {
    const plan = planWithServer('server-microcloud-h13', 16)
    plan.partitions[0].racks[0].servers[0].nodeConfigs = {
      2: { sizeId: 'c1-medium-x86' },
      5: { sizeId: 'n1-medium-x86', nicModelId: 'nic-connectx5' },
    }
    return plan
  }

  it('splits CPU and DIMM lines by configuration, once per chassis', () => {
    const plan = planWithNodeConfigs()
    // Both sizes use the same AM5 CPU; the DIMMs differ per bucket:
    // 14 nodes on n1-medium (2× 16 GB), position 3 of both chassis on
    // c1-medium (4× 32 GB each).
    expect(quantity(plan, 'cpu-epyc-4344p')).toBe(16)
    expect(quantity(plan, 'mem-ddr5u-16g')).toBe(28)
    expect(quantity(plan, 'mem-ddr5u-32g')).toBe(8)
  })

  it('orders each position its own NIC in every chassis', () => {
    const plan = planWithNodeConfigs()
    expect(quantity(plan, 'nic-e810-xxvda2')).toBe(14)
    expect(quantity(plan, 'nic-connectx5')).toBe(2)
  })

  it('names deviating positions in the reason', () => {
    const line = deriveBom(planWithNodeConfigs()).find((l) => l.catalogId === 'mem-ddr5u-32g')
    expect(
      line?.reasons.some(
        (r) => r.detail === '2 worker nodes at chassis position 3 × 4 DIMMs (c1-medium-x86)',
      ),
    ).toBe(true)
  })

  it('fits per-position GPUs in every chassis', () => {
    const plan = planWithServer('server-microcloud-h13', 16)
    plan.partitions[0].racks[0].servers[0].nodeConfigs = {
      0: { sizeId: 'n1-medium-x86', gpu: { modelId: 'gpu-h100-pcie', perNode: 1 } },
    }
    expect(quantity(plan, 'gpu-h100-pcie')).toBe(2)
  })
})

describe('deriveBom scope', () => {
  function ids(plan: Plan, scope: Parameters<typeof deriveBom>[1]): string[] {
    return deriveBom(plan, scope).map((l) => l.catalogId)
  }

  function qty(plan: Plan, scope: Parameters<typeof deriveBom>[1], id: string): number {
    return deriveBom(plan, scope).find((l) => l.catalogId === id)?.quantity ?? 0
  }

  it('defaults to everything, matching the unscoped BOM', () => {
    const plan = createEmptyPlan()
    expect(deriveBom(plan, 'all')).toEqual(deriveBom(plan))
  })

  it('keeps production gear out of the management scope and vice versa', () => {
    const plan = createEmptyPlan()
    const production = ids(plan, 'production')
    const management = ids(plan, 'management')

    // Spines, leaves, servers and their optics are production.
    expect(production).toContain('switch-as7726')
    expect(production).toContain('server-microcloud-h13')
    expect(production).toContain('cable-mtp-trunk')
    expect(management).not.toContain('switch-as7726')
    expect(management).not.toContain('server-microcloud-h13')

    // Mgmt switches, mgmt servers and the OOB copper are management.
    expect(management).toContain('switch-as4630')
    expect(management).toContain('server-mgmt-121h')
    expect(management).toContain('cable-rj45')
    expect(production).not.toContain('switch-as4630')
    expect(production).not.toContain('cable-rj45')
  })

  it('splits a line that both networks contribute to', () => {
    // 25G SR optics serve server uplinks (production) and, on an AS4630
    // mgmt tier, the mgmt leaf uplinks (management). The scopes must add up
    // to the unscoped quantity rather than either one owning the line.
    const plan = createEmptyPlan()
    const all = qty(plan, 'all', 'sfp-25g-sr')
    const production = qty(plan, 'production', 'sfp-25g-sr')
    const management = qty(plan, 'management', 'sfp-25g-sr')
    expect(production).toBeGreaterThan(0)
    expect(management).toBeGreaterThan(0)
    expect(production + management).toBe(all)
  })

  it('adds up to the whole BOM across both scopes, for every line', () => {
    const plan = createEmptyPlan()
    const total = new Map(deriveBom(plan, 'all').map((l) => [l.catalogId, l.quantity]))
    const split = new Map<string, number>()
    for (const scope of ['production', 'management'] as const) {
      for (const line of deriveBom(plan, scope)) {
        split.set(line.catalogId, (split.get(line.catalogId) ?? 0) + line.quantity)
      }
    }
    // Spares are a fixed count per line, so they do not sum; compare the
    // real lines.
    for (const [id, quantity] of total) {
      if (id.endsWith('#spare')) continue
      expect(split.get(id), `${id}`).toBe(quantity)
    }
  })

  it('scopes the per-partition BOMs too', () => {
    const plan = createEmptyPlan()
    const [{ lines }] = deriveBomByPartition(plan, 'management')
    expect(lines.map((l) => l.catalogId)).toContain('switch-as4630')
    expect(lines.map((l) => l.catalogId)).not.toContain('switch-as7726')
  })

  it('gives spares only for the lines in scope', () => {
    const plan = createEmptyPlan()
    const spares = deriveBom(plan, 'management')
      .filter((l) => l.category === SPARE_CATEGORY)
      .map((l) => l.catalogId)
    expect(spares).toContain('cable-rj45#spare')
    expect(spares).not.toContain('cable-mtp-trunk#spare')
  })
})
