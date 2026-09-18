import type { Device } from '../devices'
import type { DeviceAddresses } from '../ip/deviceAddresses'
import type { SwitchPorts } from '../ports'
import type { AnsibleOut } from './index'
import { fromObject, kv, note, toYaml, toYamlSeq, ymap, type YEntry, type YValue } from './yaml'

// Broadcom Enterprise SONiC: metal-roles' sonic-config only supports
// Edgecore SONiC, so these switches are configured with the Dell collection
// from Ansible Galaxy (dellemc.enterprise_sonic), whose resource modules
// talk to the SONiC management framework over httpapi. Argument specs were
// checked against collection 4.1.0.
//
// The structure follows a deployment running this collection on Enterprise
// SONiC: one variable per module named after it (sonic_<module>, holding
// exactly that module's `config`), one task per module in the order the
// config builds up, `replaced` for what the plan fully describes and
// `merged` for global settings. The route map LOOPBACKS limits what BGP
// redistributes to the loopback; peers use metal-stack's timers (1/3/10).
//
// What the modules don't cover, DNS servers and the routing mode metal-core
// needs on leaves, runs over SSH in config_db, as mini-lab does. The
// leaves' FRR is written by metal-core, so they get no BGP here. The port
// plan is the same as on the Edgecore path (derive/ports.ts); interface
// naming is set to native so its EthernetN names hold.

export const ENTERPRISE_SONIC_COLLECTION = 'dellemc.enterprise_sonic'
const PEER_GROUP = 'FABRIC'
const ROUTE_MAP = 'LOOPBACKS'

const SPEED: Record<number, string> = {
  1000: 'SPEED_1GB',
  10000: 'SPEED_10GB',
  25000: 'SPEED_25GB',
  100000: 'SPEED_100GB',
}

interface Step {
  module: string
  state: 'replaced' | 'merged'
  /** One call per list item (route maps, as the collection needs it). */
  perItem?: boolean
}

/** One task per module, in the order the configuration builds up. */
export const TOPICS: { topic: string; label: string; steps: Step[] }[] = [
  {
    topic: 'breakouts',
    label: 'Port breakouts',
    steps: [{ module: 'port_breakout', state: 'replaced' }],
  },
  {
    topic: 'system',
    label: 'Hostname, native interface naming, no auto-breakout',
    steps: [{ module: 'system', state: 'merged' }],
  },
  { topic: 'lldp', label: 'LLDP', steps: [{ module: 'lldp_global', state: 'merged' }] },
  {
    topic: 'interfaces',
    label: 'Port speed, FEC and MTU; loopback',
    steps: [{ module: 'interfaces', state: 'replaced' }],
  },
  { topic: 'vlans', label: 'VLANs', steps: [{ module: 'vlans', state: 'replaced' }] },
  {
    topic: 'l3',
    label: 'Loopback, VLAN and BGP port addresses',
    steps: [{ module: 'l3_interfaces', state: 'replaced' }],
  },
  {
    topic: 'dhcp-relay',
    label: 'DHCP relay of the PXE VLAN',
    steps: [{ module: 'dhcp_relay', state: 'replaced' }],
  },
  {
    topic: 'route-maps',
    label: 'Route maps',
    steps: [{ module: 'route_maps', state: 'merged', perItem: true }],
  },
  {
    topic: 'bgp',
    label: 'BGP',
    steps: [
      { module: 'bgp', state: 'replaced' },
      { module: 'bgp_af', state: 'merged' },
      { module: 'bgp_neighbors', state: 'replaced' },
    ],
  },
  { topic: 'vxlans', label: 'VTEP', steps: [{ module: 'vxlans', state: 'replaced' }] },
  { topic: 'ntp', label: 'NTP', steps: [{ module: 'ntp', state: 'merged' }] },
  // Last: switching to the mgmt VRF restarts the management services.
  { topic: 'vrfs', label: 'Management VRF', steps: [{ module: 'vrfs', state: 'merged' }] },
]

export const moduleVar = (module: string) => `sonic_${module}`

export interface EnterpriseSonicHost {
  device: Device
  addresses: DeviceAddresses
  ports: SwitchPorts | undefined
  /** Runs BGP (production switches; mgmt switches of an L3 mgmt network). */
  bgp: boolean
  /** Activates EVPN (spines, superspines, exits, storage leaves). */
  evpn: boolean
  /** Mgmt VRF on (every switch but the leaves, as metal-stack runs them). */
  mgmtVrf: boolean
  /** Mgmt servers' router ids, the leaves relay PXE DHCP to them. */
  dhcpServers: string[]
  ntpServers: string[]
}

const cfg = (module: string, value: YValue, comment?: string) =>
  kv(moduleVar(module), value, comment)

/** The sonic_<module> host variables of a Broadcom SONiC switch. */
export function enterpriseSonicHostVars(h: EnterpriseSonicHost): YEntry[] {
  const { device: d, addresses: a, ports: sp } = h
  const leaf = d.role === 'leaf'
  const vtep = leaf || d.role === 'exit'
  const planned = sp && !sp.reason ? sp : undefined
  const out: YEntry[] = []

  if (planned && planned.breakouts.length > 0) {
    out.push(
      cfg(
        'port_breakout',
        planned.breakouts.map((b) => ymap(kv('name', `1/${b.frontPanel}`), kv('mode', b.mode))),
        `Front-panel ports ${planned.breakouts.map((b) => b.port).join(', ')}.`,
      ),
    )
  }
  if (sp?.reason) out.push(note(`Port settings left open: ${sp.reason}.`))
  out.push(
    cfg(
      'system',
      ymap(
        kv('hostname', d.hostname),
        kv('interface_naming', 'native'),
        kv('auto_breakout', 'DISABLE'),
      ),
    ),
  )

  const interfaces: YValue[] = []
  if (h.bgp && a.loopback) {
    interfaces.push(
      ymap(kv('name', 'Loopback0'), kv('description', 'Router-ID'), kv('enabled', true)),
    )
  }
  for (const p of planned?.ports ?? []) {
    interfaces.push(
      ymap(
        kv('name', p.name),
        kv('description', p.use),
        kv('enabled', true),
        kv('speed', SPEED[p.speed] ?? `SPEED_${p.speed / 1000}GB`),
        ...(p.fec === 'rs' ? [kv('fec', 'FEC_RS')] : []),
        kv('mtu', p.mtu),
      ),
    )
  }
  if (interfaces.length > 0) out.push(cfg('interfaces', interfaces))

  if (vtep && a.pxe) {
    out.push(cfg('vlans', [ymap(kv('vlan_id', 4000), kv('description', 'metal-stack PXE'))]))
  }

  const l3: YValue[] = []
  if (h.bgp && a.loopback) {
    l3.push(
      ymap(
        kv('name', 'Loopback0'),
        kv('ipv4', ymap(kv('addresses', [ymap(kv('address', `${a.loopback}/32`))]))),
      ),
    )
  }
  if (vtep && a.pxe) {
    l3.push(
      ymap(kv('name', 'Vlan4000'), kv('ipv4', ymap(kv('addresses', [ymap(kv('address', a.pxe))])))),
    )
  }
  // BGP unnumbered peers over IPv6 link-local addresses.
  const bgpPorts = h.bgp && !leaf ? (planned?.bgp ?? []) : []
  for (const port of bgpPorts)
    l3.push(ymap(kv('name', port), kv('ipv6', ymap(kv('enabled', true)))))
  if (l3.length > 0) out.push(cfg('l3_interfaces', l3))

  if (leaf && a.pxe && h.dhcpServers.length > 0) {
    out.push(
      cfg(
        'dhcp_relay',
        [
          ymap(
            kv('name', 'Vlan4000'),
            kv(
              'ipv4',
              ymap(
                kv('link_select', true),
                kv(
                  'server_addresses',
                  h.dhcpServers.map((s) => ymap(kv('address', s))),
                ),
                kv('source_interface', 'Loopback0'),
              ),
            ),
          ),
        ],
        'PXE DHCP goes to the mgmt servers, relayed from the leaf loopback.',
      ),
    )
  }

  // metal-core writes the leaves' FRR.
  if (h.bgp && !leaf && d.asn && a.loopback && planned) {
    const asn = String(d.asn)
    const afis = [
      ymap(kv('activate', true), kv('afi', 'ipv4'), kv('safi', 'unicast')),
      ...(h.evpn ? [ymap(kv('activate', true), kv('afi', 'l2vpn'), kv('safi', 'evpn'))] : []),
    ]
    out.push(
      cfg('route_maps', [
        ymap(
          kv('map_name', ROUTE_MAP),
          kv('action', 'permit'),
          kv('match', ymap(kv('interface', 'Loopback0'))),
          kv('sequence_num', 10),
        ),
      ]),
      cfg('bgp', [
        ymap(
          kv('bgp_as', asn),
          kv('bestpath', ymap(kv('as_path', ymap(kv('multipath_relax', true))))),
          kv('log_neighbor_changes', true),
          kv('router_id', a.loopback),
        ),
      ]),
      cfg('bgp_af', [
        ymap(
          kv('bgp_as', asn),
          kv(
            'address_family',
            ymap(
              kv('afis', [
                ymap(
                  kv('afi', 'ipv4'),
                  kv('safi', 'unicast'),
                  kv('redistribute', [
                    ymap(kv('protocol', 'connected'), kv('route_map', ROUTE_MAP)),
                  ]),
                ),
                ...(h.evpn
                  ? [
                      ymap(
                        kv('afi', 'l2vpn'),
                        kv('safi', 'evpn'),
                        // Only a VTEP advertises its VNIs.
                        ...(vtep
                          ? [kv('advertise_all_vni', true), kv('advertise_default_gw', true)]
                          : []),
                      ),
                    ]
                  : []),
              ]),
            ),
          ),
        ),
      ]),
      cfg(
        'bgp_neighbors',
        [
          ymap(
            kv('bgp_as', asn),
            kv(
              'neighbors',
              bgpPorts.map((port) =>
                ymap(
                  kv('neighbor', port),
                  kv('capability', ymap(kv('extended_nexthop', true))),
                  kv('peer_group', PEER_GROUP),
                  kv('remote_as', ymap(kv('peer_type', 'external'))),
                ),
              ),
            ),
            kv('peer_group', [
              ymap(
                kv('name', PEER_GROUP),
                kv('address_family', ymap(kv('afis', afis))),
                kv('remote_as', ymap(kv('peer_type', 'external'))),
                kv('timers', ymap(kv('connect_retry', 10), kv('holdtime', 3), kv('keepalive', 1))),
              ),
            ]),
          ),
        ],
        'BGP unnumbered on the fabric ports.',
      ),
    )
  }

  if (vtep && a.loopback) {
    out.push(
      cfg('vxlans', [
        ymap(kv('name', 'vtep1'), kv('source_ip', a.loopback), kv('evpn_nvo', 'nvo1')),
      ]),
    )
  }
  if (h.ntpServers.length > 0) {
    out.push(
      cfg(
        'ntp',
        ymap(
          kv(
            'servers',
            h.ntpServers.map((s) => ymap(kv('address', s))),
          ),
          ...(h.mgmtVrf ? [kv('vrf', 'mgmt')] : []),
        ),
      ),
    )
  }
  if (h.mgmtVrf) out.push(cfg('vrfs', [ymap(kv('name', 'mgmt'))]))
  return out
}

function task(label: string, many: boolean, step: Step): YValue {
  const v = moduleVar(step.module)
  return fromObject({
    name: many ? `${label}: ${step.module}` : label,
    [`${ENTERPRISE_SONIC_COLLECTION}.sonic_${step.module}`]: fromObject({
      config: step.perItem ? ['{{ item }}'] : `{{ ${v} }}`,
      state: step.state,
    }),
    ...(step.perItem ? { loop: `{{ ${v} }}` } : {}),
    when: `${v} is defined`,
  })
}

/** Task files, one per topic, one module call per task. */
export function enterpriseSonicTaskFiles(out: AnsibleOut): void {
  for (const { topic, label, steps } of TOPICS) {
    out.add(
      `tasks/enterprise_sonic/${topic}.yaml`,
      toYamlSeq(
        steps.map((s) => task(label, steps.length > 1, s)),
        `Generated by the metal-stack planner. ${label} with ${ENTERPRISE_SONIC_COLLECTION}.`,
      ),
    )
  }
  // What the modules don't cover, over SSH in config_db (as mini-lab does).
  out.add(
    'tasks/enterprise_sonic/ssh.yaml',
    toYamlSeq(
      [
        fromObject({
          name: 'DNS servers',
          'ansible.builtin.command': `sonic-db-cli CONFIG_DB hset "DNS_SERVER|{{ item }}" NULL NULL`,
          loop: '{{ sonic_nameservers }}',
          changed_when: false,
        }),
        fromObject({
          name: 'Routing config mode of a leaf',
          'ansible.builtin.command':
            'sonic-db-cli CONFIG_DB hget "DEVICE_METADATA|localhost" docker_routing_config_mode',
          register: 'routing_mode',
          changed_when: false,
          when: "'leaves' in group_names",
        }),
        fromObject({
          name: 'Split routing config mode, metal-core writes frr.conf',
          'ansible.builtin.command':
            'sonic-db-cli CONFIG_DB hset "DEVICE_METADATA|localhost" docker_routing_config_mode split',
          when: "'leaves' in group_names and routing_mode.stdout != 'split'",
          notify: 'Restart bgp',
        }),
        fromObject({
          name: 'Save the configuration',
          'ansible.builtin.command': 'config save -y',
          changed_when: false,
        }),
      ],
      'Generated by the metal-stack planner. Settings the Enterprise SONiC modules do not cover.',
    ),
  )
}

/** group_vars/broadcom_sonic: connection of the modules and plan-wide values. */
export function enterpriseSonicGroupVars(out: AnsibleOut, nameservers: string[]): void {
  const dir = `${out.inventory}/group_vars/broadcom_sonic`
  out.add(
    `${dir}/connection.yaml`,
    toYaml(
      ymap(
        kv('ansible_connection', 'ansible.netcommon.httpapi'),
        kv('ansible_network_os', `${ENTERPRISE_SONIC_COLLECTION}.sonic`),
        kv('ansible_user', 'admin', 'The switch user of the management REST API.'),
        kv('ansible_httpapi_use_ssl', true),
        kv('ansible_httpapi_validate_certs', false, 'The switches serve self-signed certificates.'),
      ),
      `Broadcom Enterprise SONiC, configured with ${ENTERPRISE_SONIC_COLLECTION} over httpapi.`,
    ),
  )
  const f = `${dir}/secrets.yaml`
  out.add(
    f,
    toYaml(
      ymap(
        kv(
          'ansible_password',
          out.todo(f, 'ansible_password', 'password of the Broadcom SONiC switches (REST API)'),
        ),
      ),
      'Secrets: fill in and encrypt this file with ansible-vault before committing it.',
    ),
  )
  out.add(
    `${dir}/system.yaml`,
    toYaml(
      ymap(
        kv(
          moduleVar('lldp_global'),
          ymap(kv('enable', true), kv('hello_time', 10)),
          'metal-stack learns which machine port sits on which switch port over LLDP.',
        ),
        kv(
          'sonic_nameservers',
          nameservers,
          'Written to config_db over SSH (tasks/enterprise_sonic/ssh.yaml).',
        ),
      ),
    ),
  )
}
