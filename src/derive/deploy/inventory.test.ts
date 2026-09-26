import { describe, expect, it } from 'vitest'
import { createEmptyPlan } from '../../model/defaults'
import type { Plan } from '../../model/plan'
import { templates } from '../../model/templates'
import { exportAnsibleInventory } from '../../io/ansible'
import type { YamlMap } from '../../io/yaml'
import { deriveInventory } from './inventory'

type Host = { name: string; group: string; vars: YamlMap; groupVars: YamlMap }

/** Every host with its own and its role group's variables. */
function hostsOf(doc: YamlMap): Host[] {
  const out: Host[] = []
  const walk = (name: string, group: YamlMap) => {
    for (const [host, vars] of Object.entries((group.hosts as YamlMap) ?? {})) {
      out.push({
        name: host,
        group: name,
        vars: vars as YamlMap,
        groupVars: (group.vars as YamlMap) ?? {},
      })
    }
    for (const [child, g] of Object.entries((group.children as YamlMap) ?? {}))
      walk(child, g as YamlMap)
  }
  walk('all', doc.all as YamlMap)
  return out
}

const plans: [string, () => Plan][] = [
  ['the default plan', createEmptyPlan],
  ...templates.map((t): [string, () => Plan] => [`template ${t.name}`, t.build]),
]

describe.each(plans)('inventory of %s', (_, build) => {
  const plan = build()
  const { doc, problems } = deriveInventory(plan)
  const hosts = hostsOf(doc)
  const switches = hosts.filter(
    (h) => !/mgmt(server|firewalls)/.test(h.group) && !h.group.endsWith('mgmtservers'),
  )

  it('has no problems', () => {
    expect(problems).toEqual([])
  })

  it('gives every switch the variables sonic-config asserts, and an address', () => {
    expect(switches.length).toBeGreaterThan(0)
    for (const h of switches) {
      const asn = h.vars.sonic_config_asn ?? h.groupVars.sonic_config_asn
      expect(h.vars.sonic_config_loopback_address, `${h.name} loopback`).toMatch(
        /^\d+\.\d+\.\d+\.\d+$/,
      )
      expect(asn, `${h.name} asn`).toBeTypeOf('number')
      expect(h.vars.ansible_host, `${h.name} ansible_host`).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    }
  })

  it('gives every leaf a PXE subnet, a rack id and its spine uplinks', () => {
    const leaves = hosts.filter((h) => h.group.endsWith('_leaves'))
    expect(leaves.length).toBeGreaterThan(0)
    for (const h of leaves) {
      expect(h.vars.metal_core_cidr, h.name).toMatch(/^\d+\.\d+\.\d+\.\d+\/\d+$/)
      expect(h.vars.metal_core_rack_id, h.name).toBeTypeOf('string')
      expect((h.vars.sonic_config_bgp_ports as string[]).length, h.name).toBeGreaterThan(0)
    }
    expect(new Set(leaves.map((h) => h.vars.metal_core_cidr)).size).toBe(leaves.length)
  })

  it('never hands out an address twice', () => {
    const addresses = hosts.flatMap((h) =>
      [h.vars.sonic_config_loopback_address, h.vars.ansible_host].filter(
        (x): x is string => typeof x === 'string',
      ),
    )
    const loopbacksAndHosts = new Map<string, string[]>()
    for (const h of hosts) {
      for (const a of new Set([h.vars.sonic_config_loopback_address, h.vars.ansible_host])) {
        if (typeof a !== 'string') continue
        loopbacksAndHosts.set(a, [...(loopbacksAndHosts.get(a) ?? []), h.name])
      }
    }
    const shared = [...loopbacksAndHosts].filter(([, owners]) => owners.length > 1)
    expect(shared, 'addresses on more than one host').toEqual([])
    expect(addresses.length).toBeGreaterThan(0)
  })

  it('serves DHCP for every network a switch relays to the mgmt servers', () => {
    const toNum = (a: string) => a.split('.').reduce((n, o) => n * 256 + Number(o), 0)
    const network = (cidr: string) => {
      const [a, p] = cidr.split('/')
      const size = 2 ** (32 - Number(p))
      return toNum(a) - (toNum(a) % size)
    }
    const partitionOf = (h: Host) => h.group.replace(/_[a-z]+$/, '')
    const relayed = new Map<string, Set<number>>()
    for (const h of hosts) {
      const vlans = [
        ...((h.vars.sonic_config_vlans as YamlMap[]) ?? []),
        ...((h.groupVars.sonic_config_vlans as YamlMap[]) ?? []),
      ]
      for (const v of vlans) {
        if (!v.dhcp_servers) continue
        const ipCidr = v.ip === '{{ metal_core_cidr }}' ? h.vars.metal_core_cidr : v.ip
        const set = relayed.get(partitionOf(h)) ?? new Set<number>()
        set.add(network(ipCidr as string))
        relayed.set(partitionOf(h), set)
      }
    }
    expect(relayed.size).toBeGreaterThan(0)
    const servers = hosts.filter((h) => h.group.endsWith('_mgmtservers'))
    const ranges: [number, number][] = []
    for (const server of servers) {
      const subnets = server.vars.dhcp_subnets as YamlMap[]
      const served = new Set(subnets.map((s) => toNum(s.network as string)))
      for (const n of relayed.get(partitionOf(server)) ?? []) {
        expect(served.has(n), `${server.name} serves relayed network`).toBe(true)
      }
      for (const s of subnets) {
        const r = s.range as YamlMap | undefined
        if (r) ranges.push([toNum(r.begin as string), toNum(r.end as string)])
      }
    }
    const sorted = ranges.sort((a, b) => a[0] - b[0])
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i][0], 'DHCP ranges of the mgmt servers overlap').toBeGreaterThan(
        sorted[i - 1][1],
      )
    }
  })

  it('writes the same bytes for the same plan', () => {
    expect(exportAnsibleInventory(plan).text).toBe(exportAnsibleInventory(plan).text)
  })

  it('sets none of the inputs a plan cannot know', () => {
    const text = exportAnsibleInventory(plan).text.split('---\n')[1]
    for (const name of [
      'sonic_config_ntp',
      'sonic_config_nameservers',
      'metal_bmc_bmc_superuser_pwd',
      'metal_partition_metal_api_addr',
      'CHANGE',
    ]) {
      expect(text).not.toContain(name)
    }
  })
})

describe('deriveInventory', () => {
  it('refuses a plan it cannot generate in full', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].fabric.fabricType = 'leaf-spine-superspine'
    plan.partitions[0].fabric.superspineCount = 2
    expect(deriveInventory(plan).problems).toContain(
      `${plan.partitions[0].name}: Superspine fabrics are not cabled yet.`,
    )
  })

  it('reports a missing IP range instead of leaving addresses out silently', () => {
    const plan = createEmptyPlan()
    plan.ipPlan.infra.cidr = ''
    expect(deriveInventory(plan).problems.some((p) => p.includes('the IP plan has no'))).toBe(true)
  })

  it('reports a rack with more nodes than its leaf PXE subnets hold', () => {
    const plan = createEmptyPlan()
    const [big] = plan.partitions[0].racks
    big.servers[0].count = 64
    plan.partitions[0].racks.push({ ...big, id: 'small', name: 'Rack 2', servers: [] })
    plan.ipPlan.infra.headroomPercent = 0
    expect(deriveInventory(plan).problems.some((p) => p.includes('PXE'))).toBe(true)
  })

  it('chains each mgmt server to its firewall and mgmt spine by address', () => {
    const plan = createEmptyPlan()
    const hosts = hostsOf(deriveInventory(plan).doc)
    const server = hosts.find((h) => h.name.endsWith('-mgmtserver01'))!
    const firewall = hosts.find((h) => h.name.endsWith('-mgmtfw01'))!
    const spine = hosts.find((h) => h.name.endsWith('-mgmtspine01'))!
    expect(server.vars.mgmt_server_firewall_ip).toBe(firewall.vars.ansible_host)
    const spinePort = (spine.vars.sonic_config_ports as YamlMap).list as YamlMap[]
    const serverEno3 = (server.vars.planner_interfaces as YamlMap).eno3 as string
    const spineIp = (spinePort[0].ips as string[])[0]
    // Both ends of the same /30.
    expect(serverEno3.split('/')[1]).toBe('30')
    expect(spineIp.split('/')[1]).toBe('30')
    expect(serverEno3.split('.').slice(0, 3)).toEqual(spineIp.split('.').slice(0, 3))
  })
})
