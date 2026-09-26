import type { Partition, Plan } from '../../model/plan'
import type { YamlMap } from '../../io/yaml'
import { formatIp, subnet, type Cidr } from '../ip/cidr'
import { rackNodes } from '../nodes'
import { podsOf } from '../pods'
import { deriveIpPlan, type InfraPartition } from '../ip/ipPlan'
import {
  deriveCabling,
  hostLabel,
  hostnameProblems,
  type PartitionCabling,
  type SwitchHost,
} from './cabling'

// The Ansible inventory of a plan, in the layout of a production partition
// inventory: a group per partition with a child group per device role
// (<partition>_spines, _exits, _leaves, _storageleaves, _mgmtspines,
// _mgmtleaves, _mgmtservers, _mgmtfirewalls) and the generic role groups
// (spines, leaves, …, plus the aliases in ROLE_ALIASES) above them, so
// plays can target either.
// Variable names are the ones metal-roles reads (sonic-config, metal-core,
// mgmt-server, dhcp, pixiecore, ztp); `planner_*` variables only document
// what the plan decided, such as the cable plan per port.
//
// Addresses come from the IP plan's infrastructure ranges:
// - Loopbacks: spines, exits, storage leaves, then leaves in rack order
//   from "Underlay loopbacks"; mgmt spines, then mgmt leaves from "Mgmt
//   loopbacks". Mgmt switches are reached on their loopback.
// - Central rack management: the range is split evenly over the mgmt
//   spines; mgmt spine i's SVI takes the first address of part i and the
//   eth0 of each switch cabled to it the following ones.
// - Rack management: the mgmt leaf's SVI takes the first address, the
//   leaves' eth0 the following ones; BMCs lease the rest over DHCP.
// - PXE (vlan4000): the range is split evenly over all leaves; each leaf's
//   metal_core_cidr is the first address of its part.
// - DHCP: each mgmt server serves every network the switches relay from
//   (central and rack management, each leaf's PXE part) with the relaying
//   SVI as router, the dynamic range cut in one share per mgmt server, and
//   the ONIE / SONiC ZTP options of the dhcp and ztp role examples.
// - Mgmt links: four /30 per side, in the order firewall to mgmt server,
//   firewall to mgmt server BMC, firewall to mgmt spine eth0, mgmt server to
//   mgmt spine; the firewall (or the mgmt server on the last) takes the
//   first address.
//
// ASNs: mgmt servers 4200000001 + i, mgmt spines 4200000010 + i and mgmt
// leaves 4200000021 + i follow the deployment guide's routed out-of-band
// network; in the production network the spines share 4210000000 and the
// exits 4210000001, storage leaves take 4210000100 + i and leaves
// 4210001000 + i (this planner's convention, one ASN per leaf as in the
// production inventory). With pods, RFC 7938 section 5.2.1: the superspines
// share 4210000002, the spines of pod k share 4210000010 + k, and the
// central rack's spines keep 4210000000.
//
// What the plan cannot know is left undefined, never filled with a
// placeholder, so the roles' own "is defined" checks still stop a run; the
// list is MISSING_INPUTS.

export interface Inventory {
  doc: YamlMap
  /** Why the inventory would be incomplete or wrong; export is refused. */
  problems: string[]
}

/** Inputs no plan holds, by the role or place that needs them. */
export const MISSING_INPUTS: { where: string; inputs: string[] }[] = [
  {
    where: 'Control plane connection (partition group)',
    inputs: [
      'metal_partition_metal_api_addr, _protocol, _port, _basepath',
      'metal_partition_metal_api_hmac_edit_key, metal_partition_metal_api_hmac_view_key',
      'metal_partition_metal_api_grpc_ca_cert, _client_cert, _client_key',
      'defaults_partition_metal_apiserver_url, defaults_partition_metal_apiserver_admin_token',
    ],
  },
  {
    where: 'Release and images',
    inputs: [
      'metal_stack_release_version and setup_yaml (release vector: metal_core_image_*, metal_bmc_image_*, pixiecore_image_*, ztp_nginx_image_*, image_cache_*_image_*)',
      'sonic_image_name (SONiC image served for ZTP)',
    ],
  },
  {
    where: 'All switches (sonic-config)',
    inputs: [
      'sonic_config_nameservers',
      'sonic_config_ntp.servers',
      'sonic_config_ssh_sourceranges',
    ],
  },
  {
    where: 'Exits (sonic-config)',
    inputs: [
      'sonic_config_interconnects.internet: upstream peers, VRF, VNI, prefix lists',
      'sonic_config_vlan_subinterfaces towards the upstream',
    ],
  },
  {
    where: 'Mgmt servers',
    inputs: [
      'metal_bmc_bmc_superuser, metal_bmc_bmc_superuser_pwd, metal_bmc_nsqd_addr (metal-bmc)',
      'pixiecore_grpc_*, pixiecore_metal_hammer_logging_* (pixiecore)',
      'mgmt_server_metal_ssh_privkey, mgmt_server_metal_ssh_pubkey, mgmt_server_nameservers (mgmt-server)',
      'ztp_authorized_keys (ztp)',
      'dhcp_static_hosts: switch MACs for ZTP (dhcp)',
      'DNS servers handed out over DHCP (a domain-name-servers option per subnet)',
      'lvm_pvs: the disks (lvm)',
      'CI runner registration and WireGuard keys, if used',
    ],
  },
  {
    where: 'Mgmt firewalls',
    inputs: [
      'uplink (eth7) address, gateway and upstream',
      'firewall rules, destination and hairpin NAT: no metal-roles role exists for a generic firewall',
    ],
  },
  {
    where: 'Ansible access',
    inputs: ['ansible_user, ansible_ssh_private_key_file'],
  },
]

const ASN = {
  mgmtServer: 4200000001,
  mgmtSpine: 4200000010,
  mgmtLeaf: 4200000021,
  spines: 4210000000,
  exits: 4210000001,
  superspines: 4210000002,
  podSpines: 4210000010,
  storageLeaf: 4210000100,
  leaf: 4210001000,
} as const

/** Further generic group names production playbooks target, per role. */
const ROLE_ALIASES: Record<string, string[]> = {
  leaves: ['sonic_leaves'],
  mgmtspines: ['mgmt_spine_switches'],
  mgmtleaves: ['mgmt_leaf_switches', 'sonic_mgmtleaves'],
  mgmtservers: ['mgmt_servers'],
}

const MGMT_VLAN = 1
/** The ztp role's default port, where ZTP scripts and images are served. */
const ZTP_PORT = 8080
const MGMT_PORTS = new Set(['eth0', 'bmc', 'mgmt'])

const ip = (c: Cidr, offset: number) => formatIp(c.family, c.addr + BigInt(offset))
const withPrefix = (c: Cidr, offset: number) => `${ip(c, offset)}/${c.prefix}`

/** Splits `c` into the smallest power of two of parts that holds `parts`. */
function split(c: Cidr, parts: number): Cidr[] {
  const bits = Math.ceil(Math.log2(Math.max(parts, 1)))
  return Array.from({ length: parts }, (_, i) => subnet(c, c.prefix + bits, BigInt(i)))
}

/** Dotted netmask of an IPv4 prefix. */
function netmask(prefix: number): string {
  const bits = (0xffffffff << (32 - prefix)) >>> 0
  return [24, 16, 8, 0].map((s) => (bits >>> s) & 255).join('.')
}

/** Offsets first..last cut into `parts` contiguous shares, one per mgmt
 *  server, so two DHCP servers without failover never lease the same
 *  address. A share is missing when there are fewer addresses than parts. */
function splitRange(first: number, last: number, parts: number): ([number, number] | undefined)[] {
  const count = last - first + 1
  return Array.from({ length: parts }, (_, i) => {
    const begin = first + Math.floor((count * i) / parts)
    const end = first + Math.floor((count * (i + 1)) / parts) - 1
    return end >= begin ? [begin, end] : undefined
  })
}

const groupName = (prefix: string, role: string) => `${prefix.replace(/-/g, '_')}_${role}`

function partitionInventory(
  plan: Plan,
  partition: Partition,
  infra: InfraPartition | undefined,
  problems: string[],
): { group: YamlMap; roleGroups: Record<string, string> } {
  const c: PartitionCabling = deriveCabling(plan, partition)
  problems.push(...c.problems.map((p) => `${partition.name}: ${p}`))
  const range = (purpose: string, scope = 'Partition'): Cidr | undefined => {
    const s = infra?.subnets.find((x) => x.purpose === purpose && x.scope === scope)
    if (!s?.cidr) {
      problems.push(
        `${partition.name}: the IP plan has no "${purpose}" range for ${scope}; set the infrastructure range in the IPs tab.`,
      )
      return undefined
    }
    return s.cidr
  }

  const byRole = (role: SwitchHost['role']) => c.switches.filter((s) => s.role === role)
  const spines = byRole('spine')
  const superspines = byRole('superspine')
  const podIndex = new Map(podsOf(partition).map((pod, k) => [pod.id, k]))
  const exits = byRole('exit')
  const storageLeaves = byRole('storage-leaf')
  const leaves = byRole('leaf')
  const mgmtSpines = byRole('mgmt-spine')
  const mgmtLeaves = byRole('mgmt-leaf')

  // Cable plan per host, for planner_ports.
  const ports = new Map<string, YamlMap>()
  const note = (host: string, port: string, peer: string) => {
    const m = ports.get(host) ?? {}
    m[port] = peer
    ports.set(host, m)
  }
  for (const cable of c.cables) {
    note(cable.a.host, cable.a.port, `${cable.b.host} ${cable.b.port}`)
    note(cable.b.host, cable.b.port, `${cable.a.host} ${cable.a.port}`)
    for (const lane of cable.lanes ?? []) {
      note(cable.b.host, lane.switchPort, `${lane.server.host} ${lane.server.port}`)
    }
  }
  const sortedPorts = (host: string): YamlMap => {
    const m = ports.get(host) ?? {}
    return Object.fromEntries(
      Object.keys(m)
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
        .map((k) => [k, m[k]]),
    )
  }

  // Loopbacks.
  const loopbacks = new Map<string, string>()
  const underlay = range('Underlay loopbacks')
  ;[...spines, ...superspines, ...exits, ...storageLeaves, ...leaves].forEach((sw, i) => {
    if (underlay) loopbacks.set(sw.name, ip(underlay, i))
  })
  const mgmtLoop = range('Mgmt loopbacks')
  ;[...mgmtSpines, ...mgmtLeaves].forEach((sw, i) => {
    if (mgmtLoop) loopbacks.set(sw.name, ip(mgmtLoop, i))
  })

  // Mgmt links: four /30 per side.
  const links = range('Mgmt links')
  const link = (side: number, n: number) =>
    links ? subnet(links, 30, BigInt(side * 4 + n)) : undefined

  // Management addresses of switch eth0s and the SVIs they sit behind.
  const mgmtIf = new Map<string, YamlMap>()
  const svi = new Map<string, string>()
  const sviPorts = new Map<string, string[]>()
  // Every network a switch relays DHCP from: its gateway is the first
  // address, dynamic leases start at `firstFree`.
  const relayNets: { net: Cidr; firstFree: number; comment: string }[] = []
  const central = range('Management', 'Central rack')
  if (central && mgmtSpines.length > 0) {
    const parts = split(central, mgmtSpines.length)
    mgmtSpines.forEach((ms, i) => {
      const part = parts[i]
      svi.set(ms.name, withPrefix(part, 1))
      const attached = c.switches.filter((s) => s.mgmtAttachedTo === ms.name)
      const capacity = Number(2n ** BigInt(32 - part.prefix)) - 3
      if (attached.length > capacity) {
        problems.push(
          `${partition.name}: ${ms.name}'s management range ${withPrefix(part, 0)} is too small.`,
        )
      }
      attached.forEach((sw, k) =>
        mgmtIf.set(sw.name, { ip: withPrefix(part, k + 2), gateway_address: ip(part, 1) }),
      )
      relayNets.push({ net: part, firstFree: attached.length + 2, comment: `${ms.name} mgmt` })
    })
  }
  partition.racks.forEach((rack) => {
    const r = range('Management', rack.name)
    const ml = mgmtLeaves.find((m) => m.rackId === rack.id)
    if (!r || !ml) return
    svi.set(ml.name, withPrefix(r, 1))
    const rackLeaves = leaves.filter((l) => l.rackId === rack.id)
    rackLeaves.forEach((leaf, k) =>
      mgmtIf.set(leaf.name, { ip: withPrefix(r, k + 2), gateway_address: ip(r, 1) }),
    )
    relayNets.push({
      net: r,
      firstFree: rackLeaves.length + 2,
      comment: `${ml.name} mgmt and BMCs`,
    })
  })
  mgmtSpines.forEach((ms, i) => {
    const l = link(i, 2)
    if (l) mgmtIf.set(ms.name, { ip: withPrefix(l, 2), gateway_address: ip(l, 1) })
  })
  // Access ports of an SVI: every port facing a management interface
  // (a switch's eth0, a BMC, a control plane node's mgmt port).
  for (const cable of c.cables) {
    for (const [end, peer] of [
      [cable.a, cable.b],
      [cable.b, cable.a],
    ]) {
      if (svi.has(end.host) && end.port !== 'eth0' && MGMT_PORTS.has(peer.port)) {
        sviPorts.set(end.host, [...(sviPorts.get(end.host) ?? []), end.port])
      }
    }
  }

  // PXE: one part per leaf.
  const pxe = range('PXE (vlan4000)')
  const pxeParts = pxe && leaves.length > 0 ? split(pxe, leaves.length) : []
  if (pxeParts[0] && pxeParts[0].prefix > 30) {
    problems.push(
      `${partition.name}: the PXE range is too small to give each of ${leaves.length} leaves a subnet.`,
    )
  }

  // Mgmt servers: their spine-facing address is where DHCP is relayed to.
  const serverSpineIp = c.mgmtServers.map((_, i) => {
    const l = link(i, 3)
    return l ? ip(l, 1) : undefined
  })
  const dhcpServers = serverSpineIp.filter((x): x is string => !!x)
  leaves.forEach((leaf, i) => {
    if (pxeParts[i]) relayNets.push({ net: pxeParts[i], firstFree: 2, comment: `${leaf.name} PXE` })
  })
  // A node may PXE boot through either of its leaves, so each leaf's part
  // must hold every node of its rack.
  for (const rack of partition.racks) {
    const nodes = rackNodes(rack).total
    const i = leaves.findIndex((l) => l.rackId === rack.id)
    const part = pxeParts[i]
    if (part && nodes > Number(2n ** BigInt(32 - part.prefix)) - 3) {
      problems.push(
        `${partition.name}: ${rack.name} has ${nodes} nodes, more than its leaves' PXE subnets (${withPrefix(part, 0)}) hold; enlarge the infrastructure range or the headroom in the IPs tab.`,
      )
    }
  }
  const dhcpSubnets = (server: number): YamlMap[] => [
    ...relayNets.map(({ net, firstFree, comment }) => {
      const last = Number(2n ** BigInt(32 - net.prefix)) - 2
      const share = splitRange(firstFree, last, c.mgmtServers.length)[server]
      return {
        comment,
        network: ip(net, 0),
        netmask: netmask(net.prefix),
        range: share ? { begin: ip(net, share[0]), end: ip(net, share[1]) } : undefined,
        options: [`routers ${ip(net, 1)}`],
      }
    }),
    ...(link(server, 3)
      ? [
          {
            comment: 'eno3, to the mgmt spine',
            network: ip(link(server, 3)!, 0),
            netmask: netmask(30),
          },
        ]
      : []),
  ]

  const switchHost = (sw: SwitchHost, extra: YamlMap): YamlMap => ({
    ansible_host:
      sw.role === 'mgmt-spine' || sw.role === 'mgmt-leaf'
        ? loopbacks.get(sw.name)
        : (mgmtIf.get(sw.name)?.ip as string | undefined)?.split('/')[0],
    sonic_config_loopback_address: loopbacks.get(sw.name),
    sonic_config_mgmt_interface: mgmtIf.get(sw.name),
    sonic_config_bgp_ports: sw.bgpPorts.length > 0 ? [...sw.bgpPorts] : undefined,
    ...extra,
    planner_ports: sortedPorts(sw.name),
  })
  const hosts = (list: SwitchHost[], extra: (sw: SwitchHost, i: number) => YamlMap) =>
    Object.fromEntries(list.map((sw, i) => [sw.name, switchHost(sw, extra(sw, i))]))

  const prefix = c.prefix
  const g = (role: string) => groupName(prefix, role)
  const pxeByLeaf = new Map(leaves.map((l, i) => [l.name, pxeParts[i]]))

  const children: YamlMap = {
    [g('spines')]: {
      vars: { sonic_config_asn: ASN.spines, sonic_config_frr_l2vpn_evpn: true },
      hosts: hosts(spines, (sw) =>
        sw.podId ? { sonic_config_asn: ASN.podSpines + (podIndex.get(sw.podId) ?? 0) } : {},
      ),
    },
    [g('superspines')]: {
      vars: { sonic_config_asn: ASN.superspines, sonic_config_frr_l2vpn_evpn: true },
      hosts: hosts(superspines, () => ({})),
    },
    [g('exits')]: {
      vars: {
        sonic_config_asn: ASN.exits,
        sonic_config_frr_l2vpn_evpn: true,
        sonic_config_vtep: { enabled: true },
      },
      hosts: hosts(exits, () => ({})),
    },
    [g('storageleaves')]: {
      vars: { sonic_config_frr_l2vpn_evpn: true },
      hosts: hosts(storageLeaves, (_, i) => ({ sonic_config_asn: ASN.storageLeaf + i })),
    },
    [g('leaves')]: {
      vars: {
        sonic_config_frr_render: false,
        sonic_config_frr_l2vpn_evpn: true,
        sonic_config_vtep: { enabled: true },
        lo: '{{ sonic_config_loopback_address }}',
        asn: '{{ sonic_config_asn }}',
        dhcp_servers: dhcpServers,
        sonic_config_vlans: [
          { id: 4000, ip: '{{ metal_core_cidr }}', dhcp_servers: '{{ dhcp_servers }}' },
        ],
        metal_core_spine_uplinks: '{{ sonic_config_bgp_ports }}',
      },
      hosts: hosts(leaves, (leaf, i) => {
        const part = pxeByLeaf.get(leaf.name)
        const rackIndex = partition.racks.findIndex((r) => r.id === leaf.rackId)
        return {
          sonic_config_asn: ASN.leaf + i,
          sonic_config_breakouts:
            Object.keys(leaf.breakouts).length > 0 ? { ...leaf.breakouts } : undefined,
          metal_core_cidr: part ? withPrefix(part, 1) : undefined,
          metal_core_rack_id: `${prefix}-r${String(rackIndex + 1).padStart(2, '0')}`,
        }
      }),
    },
    [g('mgmtspines')]: {
      hosts: hosts(mgmtSpines, (ms, i) => {
        const l = link(i, 3)
        const serverPort = Object.entries(ports.get(ms.name) ?? {}).find(([, peer]) =>
          String(peer).endsWith(' eno3'),
        )?.[0]
        return {
          sonic_config_asn: ASN.mgmtSpine + i,
          sonic_config_ports:
            l && serverPort ? { list: [{ name: serverPort, ips: [withPrefix(l, 2)] }] } : undefined,
          sonic_config_vlans: svi.has(ms.name)
            ? [
                {
                  id: MGMT_VLAN,
                  ip: svi.get(ms.name),
                  dhcp_servers: dhcpServers,
                  untagged_ports: sviPorts.get(ms.name) ?? [],
                },
              ]
            : undefined,
        }
      }),
    },
    [g('mgmtleaves')]: {
      hosts: hosts(mgmtLeaves, (ml, i) => ({
        sonic_config_asn: ASN.mgmtLeaf + i,
        sonic_config_vlans: svi.has(ml.name)
          ? [
              {
                id: MGMT_VLAN,
                ip: svi.get(ml.name),
                dhcp_servers: dhcpServers,
                untagged_ports: sviPorts.get(ml.name) ?? [],
              },
            ]
          : undefined,
      })),
    },
    [g('mgmtservers')]: {
      vars: {
        mgmt_server_spine_facing_interface: 'eno3',
        dhcp_listening_interfaces: ['eno3'],
        dhcp_global_options: [
          `default-url = "http://{{ ztp_listen_address }}:${ZTP_PORT}/{{ sonic_image_name }}"`,
          'ztp_provisioning_script_url code 239 = text',
          `ztp_provisioning_script_url "http://{{ ztp_listen_address }}:${ZTP_PORT}/user.sh"`,
        ],
      },
      hosts: Object.fromEntries(
        c.mgmtServers.map((name, i) => {
          const fw = link(i, 0)
          return [
            name,
            {
              ansible_host: fw ? ip(fw, 2) : undefined,
              mgmt_server_asn: ASN.mgmtServer + i,
              mgmt_server_router_id: serverSpineIp[i],
              mgmt_server_firewall_ip: fw ? ip(fw, 1) : undefined,
              ztp_listen_address: serverSpineIp[i],
              dhcp_subnets: dhcpSubnets(i),
              pixiecore_api_host: serverSpineIp[i] ? `http://${serverSpineIp[i]}` : undefined,
              planner_interfaces: {
                eno1: fw ? withPrefix(fw, 2) : undefined,
                ipmi: link(i, 1) ? withPrefix(link(i, 1)!, 2) : undefined,
                eno3: link(i, 3) ? withPrefix(link(i, 3)!, 1) : undefined,
              },
              planner_ports: sortedPorts(name),
            },
          ]
        }),
      ),
    },
    [g('mgmtfirewalls')]: {
      hosts: Object.fromEntries(
        c.mgmtFirewalls.map((name, i) => [
          name,
          {
            ansible_host: link(i, 0) ? ip(link(i, 0)!, 1) : undefined,
            planner_interfaces: {
              eth6: link(i, 0) ? withPrefix(link(i, 0)!, 1) : undefined,
              eth5: link(i, 1) ? withPrefix(link(i, 1)!, 1) : undefined,
              eth4: link(i, 2) ? withPrefix(link(i, 2)!, 1) : undefined,
            },
            planner_ports: sortedPorts(name),
          },
        ]),
      ),
    },
  }

  return {
    group: {
      vars: { metal_partition_id: prefix, planner_partition_name: partition.name },
      children,
    },
    roleGroups: Object.fromEntries(
      [
        'superspines',
        'spines',
        'exits',
        'storageleaves',
        'leaves',
        'mgmtspines',
        'mgmtleaves',
        'mgmtservers',
        'mgmtfirewalls',
      ].map((role) => [role, g(role)]),
    ),
  }
}

export function deriveInventory(plan: Plan): Inventory {
  const problems = [...hostnameProblems(plan)]
  const infra = deriveIpPlan(plan).infra
  const partitionGroups: YamlMap = {}
  const roleChildren: Record<string, YamlMap> = {}
  for (const partition of plan.partitions) {
    const inf = infra.partitions.find((p) => p.partitionId === partition.id)
    const { group, roleGroups } = partitionInventory(plan, partition, inf, problems)
    partitionGroups[hostLabel(partition.name).replace(/-/g, '_')] = group
    for (const [role, name] of Object.entries(roleGroups)) {
      for (const generic of [role, ...(ROLE_ALIASES[role] ?? [])]) {
        roleChildren[generic] = { ...(roleChildren[generic] ?? {}), [name]: {} }
      }
    }
  }
  const doc: YamlMap = {
    all: {
      children: {
        partition: { children: partitionGroups },
        ...Object.fromEntries(
          Object.entries(roleChildren).map(([role, children]) => [role, { children }]),
        ),
      },
    },
  }
  return { doc, problems }
}
