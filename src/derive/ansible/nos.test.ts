import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { createEmptyPlan, defaultPartition } from '../../model/defaults'
import type { Nos, Plan } from '../../model/plan'
import { deriveAnsible } from './index'

/** Two partitions, one per NOS. */
function mixed(): Plan {
  const plan = createEmptyPlan()
  plan.partitions[0].fabric.nos = 'edgecore-sonic'
  const second = defaultPartition('Partition 2')
  second.fabric.nos = 'broadcom-sonic'
  plan.partitions.push(second)
  return plan
}

function withNos(nos: Nos): Plan {
  const plan = createEmptyPlan()
  plan.partitions[0].fabric.nos = nos
  return plan
}

const read = (plan: Plan, path: string) => {
  const f = deriveAnsible(plan).files.find((f) => f.path === path)
  return f ? parse(f.content) : undefined
}
const host = (plan: Plan, name: string) => read(plan, `inventories/prod/host_vars/${name}.yaml`)

describe('Edgecore SONiC path (sonic-config)', () => {
  const plan = withNos('edgecore-sonic')

  it('breaks out and sets the ports like the reference deployment', () => {
    const leaf = host(plan, 'partition-1-r01leaf01')
    expect(leaf.sonic_config_breakouts).toEqual({ Ethernet0: '4x25G', Ethernet4: '4x25G' })
    expect(leaf.sonic_config_ports).toEqual({
      default_mtu: 9216,
      list: [
        { name: 'Ethernet120', speed: 100000 },
        { name: 'Ethernet124', speed: 100000 },
      ],
    })
    const mgmtLeaf = host(plan, 'partition-1-r01mgmtleaf')
    expect(mgmtLeaf.sonic_config_ports.default_mtu).toBe(9000)
    expect(mgmtLeaf.sonic_config_ports.list.at(-1)).toEqual({ name: 'Ethernet51', speed: 25000 })
  })

  it('puts the PXE VLAN on the leaves, relayed to the mgmt servers', () => {
    const leaf = host(plan, 'partition-1-r01leaf01')
    const servers = ['mgmtserver01', 'mgmtserver02'].map(
      (m) => host(plan, `partition-1-${m}`).mgmt_server_router_id,
    )
    expect(leaf.sonic_config_vlans).toEqual([
      { id: 4000, ip: leaf.metal_core_cidr, dhcp_servers: servers },
    ])
    const leaves = read(plan, 'inventories/prod/group_vars/partition_1_leaves/sonic.yaml')
    expect(leaves).toMatchObject({
      sonic_config_vtep: { enabled: true },
      sonic_config_mgmt_vrf: false,
    })
  })

  it('uses only sonic-config plays', () => {
    const prod = read(plan, 'deploy_prod_network.yaml')
    expect(prod.map((p: { hosts: string }) => p.hosts)).toEqual([
      'superspines:spines:exits:storageleaves:&edgecore_sonic',
      'leaves:&edgecore_sonic',
      'leaves',
    ])
    expect(deriveAnsible(plan).files.some((f) => f.path.startsWith('tasks/'))).toBe(false)
  })
})

describe('Broadcom SONiC path (dellemc.enterprise_sonic)', () => {
  const plan = withNos('broadcom-sonic')

  it('configures a spine topic by topic', () => {
    const spine = host(plan, 'partition-1-spine01')
    expect(Object.keys(spine).filter((k) => k.startsWith('sonic_config_'))).toEqual([])
    expect(spine.sonic_system).toEqual({
      hostname: 'partition-1-spine01',
      interface_naming: 'native',
      auto_breakout: 'DISABLE',
    })
    expect(spine.sonic_interfaces[0]).toEqual({
      name: 'Loopback0',
      description: 'Router-ID',
      enabled: true,
    })
    expect(spine.sonic_interfaces[1]).toMatchObject({
      name: 'Ethernet0',
      speed: 'SPEED_100GB',
      mtu: 9216,
      enabled: true,
    })
    const [neighbors] = spine.sonic_bgp_neighbors
    expect(neighbors.bgp_as).toBe('4200020000')
    expect(neighbors.neighbors.map((n: { neighbor: string }) => n.neighbor)).toEqual([
      'Ethernet0',
      'Ethernet4',
      'Ethernet8',
      'Ethernet12',
    ])
    expect(neighbors.peer_group[0].address_family.afis.map((a: { afi: string }) => a.afi)).toEqual([
      'ipv4',
      'l2vpn',
    ])
    expect(neighbors.peer_group[0].timers).toEqual({ connect_retry: 10, holdtime: 3, keepalive: 1 })
    expect(neighbors.neighbors[0].capability).toEqual({ extended_nexthop: true })
    // Only the loopback is redistributed; a spine is no VTEP.
    const [af] = spine.sonic_bgp_af
    expect(af.address_family.afis[0].redistribute).toEqual([
      { protocol: 'connected', route_map: 'LOOPBACKS' },
    ])
    expect(af.address_family.afis[1]).toEqual({ afi: 'l2vpn', safi: 'evpn' })
    expect(spine.sonic_route_maps[0]).toMatchObject({
      map_name: 'LOOPBACKS',
      match: { interface: 'Loopback0' },
    })
    expect(spine.sonic_vrfs).toEqual([{ name: 'mgmt' }])
    expect(spine.sonic_ntp.vrf).toBe('mgmt')
  })

  it('prepares the leaves for metal-core', () => {
    const leaf = host(plan, 'partition-1-r01leaf01')
    expect(leaf.sonic_port_breakout).toEqual([
      { name: '1/1', mode: '4x25G' },
      { name: '1/2', mode: '4x25G' },
    ])
    expect(leaf.sonic_vlans).toEqual([{ vlan_id: 4000, description: 'metal-stack PXE' }])
    // Server ports per breakout lane, RS-FEC and MTU 9000.
    const servers = leaf.sonic_interfaces.filter(
      (i: { description: string }) => i.description === 'servers',
    )
    expect(servers).toHaveLength(8)
    expect(servers[0]).toEqual({
      name: 'Ethernet0',
      description: 'servers',
      enabled: true,
      speed: 'SPEED_25GB',
      fec: 'FEC_RS',
      mtu: 9000,
    })
    expect(leaf.sonic_dhcp_relay[0]).toMatchObject({
      name: 'Vlan4000',
      ipv4: { source_interface: 'Loopback0', link_select: true },
    })
    expect(leaf.sonic_vxlans[0]).toMatchObject({
      name: 'vtep1',
      source_ip: leaf.lo,
      evpn_nvo: 'nvo1',
    })
    // metal-core renders the leaves' FRR, the mgmt VRF stays off.
    expect(leaf.sonic_bgp).toBeUndefined()
    expect(leaf.sonic_vrfs).toBeUndefined()
    expect(leaf.metal_core_spine_uplinks).toEqual(['Ethernet120', 'Ethernet124'])
  })

  it('writes the topic tasks, the SSH play and the collection requirement', () => {
    const { files, placeholders } = deriveAnsible(plan)
    const bgp = read(plan, 'tasks/enterprise_sonic/bgp.yaml')
    expect(
      bgp.map((t: Record<string, { state: string }>) => {
        const module = Object.keys(t)[1]
        return [module, t[module].state]
      }),
    ).toEqual([
      ['dellemc.enterprise_sonic.sonic_bgp', 'replaced'],
      ['dellemc.enterprise_sonic.sonic_bgp_af', 'merged'],
      ['dellemc.enterprise_sonic.sonic_bgp_neighbors', 'replaced'],
    ])
    const prodTopics = read(plan, 'deploy_prod_network.yaml')[0].tasks.map(
      (t: { tags: string[] }) => t.tags[0],
    )
    expect(prodTopics).toEqual([
      'breakouts',
      'system',
      'lldp',
      'interfaces',
      'vlans',
      'l3',
      'dhcp-relay',
      'route-maps',
      'bgp',
      'vxlans',
      'ntp',
      'vrfs',
    ])
    const prod = read(plan, 'deploy_prod_network.yaml')
    expect(prod.map((p: { hosts: string }) => p.hosts)).toEqual([
      'superspines:spines:exits:storageleaves:leaves:&broadcom_sonic',
      'superspines:spines:exits:storageleaves:leaves:&broadcom_sonic',
      'leaves',
    ])
    expect(prod[1].vars).toEqual({ ansible_connection: 'ansible.builtin.ssh' })
    expect(prod[2].vars).toEqual({ ansible_connection: 'ansible.builtin.ssh' })
    const req = read(plan, 'requirements.yaml')
    expect(req.collections.map((c: { name: string }) => c.name)).toContain(
      'dellemc.enterprise_sonic',
    )
    expect(files.some((f) => f.path.endsWith('group_vars/broadcom_sonic/connection.yaml'))).toBe(
      true,
    )
    expect(placeholders.filter((p) => p.key === 'ansible_password')).toHaveLength(1)
  })
})

describe('mixed NOS and PXE DHCP', () => {
  it('groups each partition by its NOS', () => {
    const inventory = read(mixed(), 'inventories/prod/inventory.yaml')
    const groups = inventory.all.children.partition.children
    expect(Object.keys(groups.edgecore_sonic.children)).toContain('partition_1_leaves')
    expect(Object.keys(groups.broadcom_sonic.children)).toContain('partition_2_leaves')
    expect(Object.keys(groups.broadcom_sonic.children)).not.toContain('partition_1_leaves')
  })

  it('leases every leaf PXE network from the mgmt servers', () => {
    const dhcp = read(
      createEmptyPlan(),
      'inventories/prod/group_vars/partition_1_mgmtservers/dhcp.yaml',
    )
    const pxe = dhcp.dhcp_subnets.filter((s: { comment: string }) => s.comment.startsWith('PXE'))
    expect(pxe).toHaveLength(2)
    expect(pxe[0]).toEqual({
      comment: 'PXE network of partition-1-r01leaf01',
      network: '172.16.0.32',
      netmask: '255.255.255.224',
      range: { begin: '172.16.0.34', end: '172.16.0.62' },
      options: ['routers 172.16.0.33'],
    })
    // The mgmt loopback network dhcpd listens on, without leases.
    expect(dhcp.dhcp_subnets[0].range).toBeUndefined()
  })
})

const TEMPLATE_IDS = ['starter', 'redundant', 'three-partitions'] as const

describe('every switch and leaf, both NOS', () => {
  it.each(
    TEMPLATE_IDS.flatMap((id) =>
      (['edgecore-sonic', 'broadcom-sonic'] as const).map((nos) => ({ id, nos })),
    ),
  )(
    'gets FRR from exactly one source and relays PXE DHCP on every leaf ($id, $nos)',
    async ({ id, nos }) => {
      const { templates } = await import('../../model/templates')
      const plan = templates.find((t) => t.id === id)!.build()
      for (const p of plan.partitions) p.fabric.nos = nos
      const { files, devices } = deriveAnsible(plan)
      const vars = (h: string) =>
        parse(files.find((f) => f.path === `inventories/prod/host_vars/${h}.yaml`)!.content)
      const group = (g: string) => {
        const f = files.find((f) => f.path === `inventories/prod/group_vars/${g}/sonic.yaml`)
        return f ? parse(f.content) : {}
      }
      devices.forEach((p, i) => {
        const l3 = plan.partitions[i].fabric.mgmt.layer === 'l3'
        for (const d of p.devices) {
          if (d.role === 'router' || d.role === 'mgmt-server') continue
          const v = vars(d.hostname)
          const bgpSpeaker = !d.role.startsWith('mgmt') || l3
          const g = group(
            `${p.group}_${{ leaf: 'leaves', spine: 'spines', superspine: 'superspines', exit: 'exits', 'storage-leaf': 'storageleaves', 'mgmt-spine': 'mgmtspines', 'mgmt-leaf': 'mgmtleaves' }[d.role]}`,
          )
          const sources = [
            // sonic-config renders frr.conf unless told not to.
            nos === 'edgecore-sonic' && bgpSpeaker && g.sonic_config_frr_render !== false,
            // The collection's BGP modules.
            v.sonic_bgp !== undefined,
            // metal-core writes the leaves' frr.conf.
            d.role === 'leaf',
          ].filter(Boolean)
          expect(sources, d.hostname).toHaveLength(bgpSpeaker ? 1 : 0)
          if (d.role === 'leaf') {
            const relayed =
              nos === 'edgecore-sonic'
                ? v.sonic_config_vlans?.[0]?.dhcp_servers
                : v.sonic_dhcp_relay?.[0]?.ipv4?.server_addresses
            expect(relayed?.length, d.hostname).toBeGreaterThan(0)
          }
        }
      })
    },
  )
})
