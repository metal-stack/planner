import { describe, expect, it } from 'vitest'
import { deriveBom } from '../derive/bom'
import {
  catalog,
  cpusForServer,
  defaultNicId,
  dimmsForServer,
  driveOptions,
  gpusForServer,
  itemLabel,
  legacyIdMap,
  nicsForUplink,
  nosLabel,
  nosLicenseId,
  nosOptions,
  portCount,
  serversForUsage,
  switchesForRole,
  type CatalogItem,
} from './catalog'
import { templates } from './templates'

// The catalog is data, so what needs testing is its consistency: the
// description grammar documented in catalog.ts's header, and the invariants
// the derivation code relies on. Without this, every new entry is free to
// re-introduce the inconsistencies this grammar exists to remove.

const entries = Object.entries(catalog)

function labelOf(id: string, item: CatalogItem): string {
  return `${id} (${item.model ?? item.partNumber ?? '—'})`
}

describe('catalog integrity', () => {
  it('keys match their id field', () => {
    for (const [id, item] of entries) expect(item.id, `${id}.id`).toBe(id)
  })

  it('has no duplicate part numbers', () => {
    const seen = new Map<string, string>()
    for (const [id, item] of entries) {
      if (!item.partNumber) continue
      const previous = seen.get(item.partNumber)
      expect(previous, `${item.partNumber} used by both ${previous} and ${id}`).toBeUndefined()
      seen.set(item.partNumber, id)
    }
  })

  it('resolves every legacy id', () => {
    for (const [from, to] of Object.entries(legacyIdMap)) {
      expect(catalog[to], `legacyIdMap['${from}'] -> ${to}`).toBeDefined()
    }
  })

  it('resolves a license for every NOS and license class', () => {
    for (const option of nosOptions) {
      for (const [licenseClass, licenseId] of Object.entries(option.licenses)) {
        const item = catalog[licenseId]
        expect(item, `${option.id}.licenses['${licenseClass}'] -> ${licenseId}`).toBeDefined()
        expect(item.category, `${licenseId}.category`).toBe('license')
      }
    }
  })

  it('licenses every switch under every NOS', () => {
    const switches = entries.filter(([, i]) => i.category === 'switch')
    for (const [id] of switches) {
      for (const option of nosOptions) {
        expect(nosLicenseId(option.id, id), `${id} under ${option.id}`).toBeDefined()
      }
    }
  })

  it('gives no license to anything that is not a switch', () => {
    for (const [id, item] of entries) {
      if (item.category === 'switch') continue
      expect(item.licenseClass, `${id}.licenseClass`).toBeUndefined()
    }
  })
})

describe('description grammar', () => {
  it('is non-empty and has no trailing period', () => {
    for (const [id, item] of entries) {
      expect(item.description.trim(), `${id}.description`).not.toBe('')
      expect(item.description, `${id}.description ends with a period`).not.toMatch(/\.$/)
    }
  })

  it('uses × and → rather than x and ->', () => {
    for (const [id, item] of entries) {
      // "2x 25G", "4x LC" — a count written with an ASCII x.
      expect(item.description, `${id}.description uses "x" as a multiplier`).not.toMatch(
        /\d\s*x\s/i,
      )
      expect(item.description, `${id}.description uses "->"`).not.toContain('->')
    }
  })

  it('does not repeat the vendor, model or part number', () => {
    for (const [id, item] of entries) {
      const label = labelOf(id, item)
      for (const field of ['vendor', 'model', 'partNumber'] as const) {
        const value = item[field]
        if (!value) continue
        expect(item.description, `${label}.description repeats ${field} "${value}"`).not.toContain(
          value,
        )
      }
    }
  })

  it('does not restate heightUnits or nodesPerChassis in prose', () => {
    for (const [id, item] of entries) {
      expect(item.description, `${labelOf(id, item)}.description states a U height`).not.toMatch(
        /\b\d+\s?U\b/,
      )
      expect(item.description, `${labelOf(id, item)}.description states a node count`).not.toMatch(
        /\b\d+\s+nodes?\b/i,
      )
    }
  })

  it('spells port speeds the way PortSpeed does', () => {
    for (const [id, item] of entries) {
      expect(item.description, `${labelOf(id, item)}.description says GbE/GE`).not.toMatch(
        /\d+\s?Gb?E\b/,
      )
    }
  })
})

describe('category invariants', () => {
  it('gives every switch ports, height, roles and a license', () => {
    for (const [id, item] of entries) {
      if (item.category !== 'switch') continue
      expect(item.ports?.length, `${id}.ports`).toBeGreaterThan(0)
      expect(item.heightUnits, `${id}.heightUnits`).toBeGreaterThan(0)
      expect(item.powerWatts, `${id}.powerWatts`).toBeGreaterThan(0)
      expect(item.switchRoles?.length, `${id}.switchRoles`).toBeGreaterThan(0)
      expect(item.licenseClass, `${id}.licenseClass`).toBeDefined()
      expect(item.vendor, `${id}.vendor`).toBeDefined()
    }
  })

  it('gives every server height, power, nodes and usages', () => {
    for (const [id, item] of entries) {
      if (item.category !== 'server') continue
      expect(item.heightUnits, `${id}.heightUnits`).toBeGreaterThan(0)
      expect(item.powerWatts, `${id}.powerWatts`).toBeGreaterThan(0)
      expect(item.nodesPerChassis, `${id}.nodesPerChassis`).toBeGreaterThan(0)
      expect(item.serverUsages?.length, `${id}.serverUsages`).toBeGreaterThan(0)
      expect(item.vendor, `${id}.vendor`).toBeDefined()
      if (item.socket) expect(item.dimmSlots, `${id}.dimmSlots`).toBeGreaterThan(0)
    }
  })

  it('gives every CPU its orderable and compatibility facts', () => {
    const cpus = entries.filter(([, item]) => item.category === 'cpu')
    expect(cpus.length).toBeGreaterThan(0)
    for (const [id, item] of cpus) {
      expect(item.vendor, `${id}.vendor`).toBeDefined()
      expect(item.partNumber, `${id}.partNumber`).toBeDefined()
      expect(item.socket, `${id}.socket`).toBeDefined()
      expect(item.cores, `${id}.cores`).toBeGreaterThan(0)
      expect(item.powerWatts, `${id}.powerWatts`).toBeGreaterThan(0)
    }
  })

  it('gives every memory module its orderable and capacity facts', () => {
    const memory = entries.filter(([, item]) => item.category === 'memory')
    expect(memory.length).toBeGreaterThan(0)
    for (const [id, item] of memory) {
      expect(item.vendor, `${id}.vendor`).toBeDefined()
      expect(item.partNumber, `${id}.partNumber`).toBeDefined()
      expect(item.dimmType, `${id}.dimmType`).toBeDefined()
      expect(item.dimmGiB, `${id}.dimmGiB`).toBeGreaterThan(0)
    }
  })

  it('gives every drive its orderable facts', () => {
    const drives = entries.filter(([, item]) => item.category === 'drive')
    expect(drives.length).toBeGreaterThan(0)
    for (const [id, item] of drives) {
      expect(item.vendor, `${id}.vendor`).toBeDefined()
      expect(item.partNumber, `${id}.partNumber`).toBeDefined()
    }
  })

  it('gives every GPU a power draw, a part number and a slot width', () => {
    const gpus = entries.filter(([, i]) => i.category === 'gpu')
    expect(gpus.length).toBeGreaterThan(0)
    for (const [id, item] of gpus) {
      expect(item.powerWatts, `${id}.powerWatts`).toBeGreaterThan(0)
      expect(item.partNumber, `${id}.partNumber`).toBeDefined()
      expect(item.gpuWidth, `${id}.gpuWidth`).toBeDefined()
    }
  })

  it('gives every GPU-capable server a bay width', () => {
    for (const [id, item] of entries) {
      if (item.category !== 'server' || !item.gpuCapable) continue
      expect(item.gpuWidth, `${id}.gpuWidth`).toBeDefined()
    }
  })

  it('only marks a server GPU-capable with a positive node limit', () => {
    for (const [id, item] of entries) {
      if (item.gpuCapable === undefined) continue
      expect(item.category, `${id}.category`).toBe('server')
      expect(item.gpuCapable, `${id}.gpuCapable`).toBeGreaterThan(0)
    }
  })
})

describe('reachability', () => {
  // Every entry must be able to reach a BOM: either a dropdown offers it, or
  // some plan produces it. Reachability is proved by construction — a plan
  // exercising every option is run through deriveBom — rather than by
  // grepping the derivation source, so a rule that stops emitting an item
  // fails here too.
  const offered = new Set(
    [
      ...switchesForRole('leaf'),
      ...switchesForRole('spine'),
      ...switchesForRole('superspine'),
      ...switchesForRole('exit'),
      ...switchesForRole('storage-leaf'),
      ...switchesForRole('mgmt-spine'),
      ...switchesForRole('mgmt-leaf'),
      ...serversForUsage('worker'),
      ...serversForUsage('management'),
      ...serversForUsage('storage'),
      ...gpusForServer('server-superserver-tn12'),
      ...nicsForUplink('2x25G'),
      ...nicsForUplink('2x100G'),
      ...driveOptions(),
      // Every board's CPU and DIMM dropdowns, so a part reachable only
      // through a newly annotated socket counts as offered.
      ...Object.values(catalog)
        .filter((item) => item.category === 'server')
        .flatMap((server) => [...cpusForServer(server.id), ...dimmsForServer(server.id)]),
    ].map((i) => i.id),
  )

  /** A plan touching every derived line: both uplink speeds, a GPU, a
   *  superspine tier, storage leaves and routers. `mgmtModelId` picks the
   *  management tier, which decides the mgmt uplink speed (25G on the
   *  AS4630, 10G on the AS4625) and therefore which SR optic is ordered. */
  function exhaustivePlan(mgmtModelId: string) {
    const plan = templates[1].build()
    const partition = plan.partitions[0]
    partition.fabric.fabricType = 'leaf-spine-superspine'
    partition.fabric.superspineCount = 2
    partition.fabric.storageLeafCount = 2
    partition.fabric.routerCount = 2
    partition.fabric.mgmt.leafModelId = mgmtModelId
    partition.fabric.mgmt.spineModelId = mgmtModelId
    const rack = partition.racks[0]
    rack.servers[0].uplink = '2x25G'
    rack.servers[0].modelId = 'server-microcloud-x13'
    rack.servers[0].gpu = { modelId: 'gpu-rtx-6000-ada', perNode: 1 }
    rack.servers.push({
      id: 'exhaustive-100g',
      role: 'worker',
      modelId: 'server-bigtwin-x12',
      count: 4,
      uplink: '2x100G',
      sizeId: 'n1-medium-x86',
      nodeConfigs: {},
    })
    return plan
  }

  const produced = new Set(
    ['switch-as4630', 'switch-as4625']
      .flatMap((mgmt) =>
        nosOptions.flatMap((option) => {
          const plan = exhaustivePlan(mgmt)
          plan.partitions[0].fabric.nos = option.id
          return deriveBom(plan)
        }),
      )
      .map((line) => line.catalogId.split('#')[0]),
  )

  const unreachable = entries
    .filter(([id]) => !offered.has(id) && !produced.has(id))
    .map(([id]) => id)

  it('produces the GPU, both NIC types and every cable kind', () => {
    for (const id of [
      'gpu-rtx-6000-ada',
      'nic-e810-xxvda2',
      'nic-e810-cqda2',
      'cable-mtp-trunk',
      'cable-mtp-breakout',
      'cable-lc-duplex',
      'cable-rj45',
      'sfp-25g-sr',
      'sfp-100g-sr4',
      'router-internet',
    ]) {
      expect(produced.has(id), `${id} never reaches a BOM`).toBe(true)
    }
  })

  it('declares every unreachable entry as referenceOnly', () => {
    const undeclared = unreachable.filter((id) => !catalog[id].referenceOnly)
    expect(
      undeclared,
      'unreachable and undeclared — wire them up, remove them, or set referenceOnly',
    ).toEqual([])
  })

  it('does not mark a reachable entry referenceOnly', () => {
    const contradictory = entries
      .filter(([id, item]) => item.referenceOnly && !unreachable.includes(id))
      .map(([id]) => id)
    expect(contradictory, 'reachable, so referenceOnly is wrong').toEqual([])
  })
})

describe('helpers', () => {
  it('counts ports by speed', () => {
    expect(portCount(catalog['switch-as4630'], '1G')).toBe(48)
    expect(portCount(catalog['switch-as4630'], '25G')).toBe(4)
    expect(portCount(catalog['switch-as7726'], '1G')).toBe(0)
  })

  it('filters switches and servers by role and usage', () => {
    expect(switchesForRole('spine').map((i) => i.id)).toContain('switch-as7726')
    expect(switchesForRole('spine').map((i) => i.id)).not.toContain('switch-as4630')
    expect(serversForUsage('management').map((i) => i.id)).toEqual([
      'server-mgmt-121h',
      'server-mgmt',
    ])
  })

  it('sorts eol and withdrawn hardware to the bottom', () => {
    const lists = [
      serversForUsage('worker'),
      serversForUsage('management'),
      switchesForRole('leaf'),
    ]
    for (const list of lists) {
      const current = list.filter((i) => (i.availability ?? 'current') === 'current')
      const eol = list.filter((i) => i.availability === 'eol')
      const withdrawn = list.filter((i) => i.availability === 'withdrawn')
      expect(list).toEqual([...current, ...eol, ...withdrawn])
    }
  })

  it('offers GPUs only for GPU-capable servers, filtered by bay width', () => {
    expect(gpusForServer('server-superserver-tn12').length).toBeGreaterThan(0)
    // The MicroCloud bays are single-width; no cataloged GPU fits.
    expect(gpusForServer('server-microcloud-x13')).toEqual([])
    expect(gpusForServer('server-bigtwin-x11')).toEqual([])
    expect(gpusForServer('nope')).toEqual([])
  })

  it('offers NICs by uplink speed and picks the E810 defaults', () => {
    const twentyFive = nicsForUplink('2x25G').map((item) => item.id)
    expect(twentyFive).toContain('nic-xxv710-da2')
    expect(twentyFive).toContain('nic-connectx5')
    expect(twentyFive).not.toContain('nic-e810-cqda2')
    expect(nicsForUplink('2x100G').map((item) => item.id)).toEqual(['nic-e810-cqda2'])
    expect(defaultNicId('2x25G')).toBe('nic-e810-xxvda2')
    expect(defaultNicId('2x100G')).toBe('nic-e810-cqda2')
  })

  it('offers CPU and memory parts matching the server socket', () => {
    expect(cpusForServer('server-microcloud-h13').map((item) => item.socket)).toEqual([
      'AM5',
      'AM5',
    ])
    // The soldered X11 MicroCloud offers memory but no CPUs.
    expect(cpusForServer('server-microcloud-x11')).toEqual([])
    expect(dimmsForServer('server-microcloud-x11').map((item) => item.dimmType)).toEqual([
      'ddr4-rdimm',
      'ddr4-rdimm',
    ])
    expect(dimmsForServer('server-microcloud-h13').map((item) => item.dimmType)).toEqual([
      'ddr5-ecc-udimm',
      'ddr5-ecc-udimm',
    ])
    expect(dimmsForServer('server-bigtwin-x12').map((item) => item.dimmType)).toEqual([
      'ddr4-rdimm',
      'ddr4-rdimm',
    ])
  })

  it('picks the license by NOS and platform tier', () => {
    expect(nosLicenseId('broadcom-sonic', 'switch-as7726')).toBe('lic-sonic-eb-100g')
    expect(nosLicenseId('broadcom-sonic', 'switch-as4630')).toBe('lic-sonic-eb-10g')
    expect(nosLicenseId('edgecore-sonic', 'switch-as7726')).toBe('lic-sonic-100g')
    expect(nosLicenseId('edgecore-sonic', 'switch-as4630')).toBe('lic-sonic-25g')
    // Not a switch: no license.
    expect(nosLicenseId('broadcom-sonic', 'server-mgmt')).toBeUndefined()
  })

  it('names the NOS by vendor and product', () => {
    expect(nosLabel('broadcom-sonic')).toBe('Broadcom Enterprise SONiC')
    expect(nosLabel('edgecore-sonic')).toBe('Edgecore Enterprise SONiC')
  })

  it('labels items by model, falling back to part number then id', () => {
    expect(itemLabel('switch-as7726')).toBe('AS7726-32X')
    expect(itemLabel('cable-rj45')).toBe('cable-rj45')
    expect(itemLabel('nope')).toBe('nope')
  })
})
