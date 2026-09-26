import { describe, expect, it } from 'vitest'
import { catalog, sonicPortNames, type PortSpeed } from '../../model/catalog'
import { createEmptyPlan, withRackKind } from '../../model/defaults'
import type { Plan } from '../../model/plan'
import { templates } from '../../model/templates'
import { deriveBom } from '../bom'
import { leafPortsNeeded } from '../validate'
import { deriveCabling, hostLabel, hostnameProblems, type CableKind } from './cabling'

const BOM_ID: Record<CableKind, string> = {
  'mtp-trunk': 'cable-mtp-trunk',
  'mtp-breakout': 'cable-mtp-breakout',
  'lc-duplex': 'cable-lc-duplex',
  rj45: 'cable-rj45',
}

/** Storage leaves, routers, a 100G group, an odd node count and a rack group. */
function everythingPlan(): Plan {
  const plan = createEmptyPlan()
  const partition = plan.partitions[0]
  partition.fabric.storageLeafCount = 2
  partition.fabric.routerCount = 2
  partition.fabric.leafSpineLinks = 2
  partition.racks[0].servers.push({
    id: 'g100',
    role: 'worker',
    modelId: 'server-bigtwin-x12',
    count: 4,
    uplink: '2x100G',
  })
  partition.racks[0].servers[0].count = 9
  const group = withRackKind(partition, { ...partition.racks[0], id: 'grp' }, 'rack-group')
  partition.racks.push(group)
  return plan
}

const plans: [string, () => Plan][] = [
  ['the default plan', createEmptyPlan],
  ...templates.map((t): [string, () => Plan] => [`template ${t.name}`, t.build]),
  ['a plan with every cabled feature', everythingPlan],
]

describe.each(plans)('cabling of %s', (_, build) => {
  const plan = build()
  plan.sparesPerLine = 0
  const cablings = plan.partitions.map((p) => deriveCabling(plan, p))

  it('has no problems', () => {
    expect(cablings.flatMap((c) => c.problems)).toEqual([])
  })

  it('orders exactly the cables it lays, per cable type', () => {
    const bom = deriveBom(plan)
    for (const kind of Object.keys(BOM_ID) as CableKind[]) {
      const laid = cablings.flatMap((c) => c.cables).filter((c) => c.kind === kind).length
      const ordered = bom.find((l) => l.catalogId === BOM_ID[kind])?.quantity ?? 0
      expect(laid, kind).toBe(ordered)
    }
  })

  it('uses every switch port at most once, and only ports the model has', () => {
    for (const c of cablings) {
      const models = new Map(c.switches.map((s) => [s.name, s.modelId]))
      const used = new Set<string>()
      for (const cable of c.cables) {
        for (const end of [cable.a, cable.b]) {
          const model = models.get(end.host)
          if (!model) continue
          const key = `${end.host}/${end.port}`
          expect(used.has(key), key).toBe(false)
          used.add(key)
          if (end.port === 'eth0') continue
          const real = (['1G', '10G', '25G', '100G'] as PortSpeed[]).flatMap((s) =>
            sonicPortNames(model, s),
          )
          expect(real, `${key} on ${catalog[model]?.model}`).toContain(end.port)
        }
      }
    }
  })

  it('takes as many leaf ports for servers as the capacity check counts', () => {
    for (const [i, p] of plan.partitions.entries()) {
      for (const rack of p.racks) {
        const leaves = new Set(
          cablings[i].switches
            .filter((s) => s.rackId === rack.id && s.role === 'leaf')
            .map((s) => s.name),
        )
        const serverPorts = cablings[i].cables.filter(
          (c) => leaves.has(c.b.host) && /-node\d+$/.test(c.a.host),
        ).length
        expect(serverPorts, rack.name).toBe(leafPortsNeeded(rack))
      }
    }
  })
})

describe('deriveCabling', () => {
  it('puts the spine uplinks of a 32-port leaf on its top ports', () => {
    const plan = createEmptyPlan()
    const leaf = deriveCabling(plan, plan.partitions[0]).switches.find((s) => s.role === 'leaf')!
    expect(leaf.bgpPorts).toEqual(['Ethernet120', 'Ethernet124'])
  })

  it('chains each mgmt firewall, mgmt server and mgmt spine one to one', () => {
    const plan = createEmptyPlan()
    const c = deriveCabling(plan, plan.partitions[0])
    const prefix = hostLabel(plan.partitions[0].name)
    const ends = (host: string) =>
      c.cables
        .filter((x) => x.a.host === host || x.b.host === host)
        .map((x) => (x.a.host === host ? x.b.host : x.a.host))
        .sort()
    expect(ends(`${prefix}-mgmtfw01`)).toEqual([
      `${prefix}-mgmtserver01`,
      `${prefix}-mgmtserver01`,
      `${prefix}-mgmtspine01`,
    ])
    expect(ends(`${prefix}-mgmtserver02`)).toEqual([
      `${prefix}-mgmtfw02`,
      `${prefix}-mgmtfw02`,
      `${prefix}-mgmtspine02`,
    ])
  })

  it('refuses what it cannot cable yet instead of cabling part of it', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].fabric.fabricType = 'leaf-spine-superspine'
    plan.partitions[0].fabric.superspineCount = 2
    plan.partitions[0].fabric.mgmt.spineModelId = 'switch-as4625'
    const problems = deriveCabling(plan, plan.partitions[0]).problems
    expect(problems).toContain('Superspine fabrics are not cabled yet.')
    expect(problems.some((p) => p.startsWith('No SONiC port map for AS4625-54T'))).toBe(true)
  })

  it('reports partitions whose names collide as hostnames', () => {
    const plan = createEmptyPlan()
    plan.partitions.push({ ...plan.partitions[0], id: 'p2', name: `${plan.partitions[0].name}!` })
    expect(hostnameProblems(plan)).toHaveLength(1)
  })
})
