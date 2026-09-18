import { devicesOf, type Device, type PartitionDevices } from '../devices'
import { formatCidr, formatIp, type Cidr } from '../ip/cidr'
import type { PartitionAddresses } from '../ip/deviceAddresses'
import type { AnsibleContext } from './index'
import { partitionGroup, rackGroup } from './inventory'
import { kv, note, toYaml, ymap, type YEntry, type YValue } from './yaml'

// group_vars and host_vars for the metal-roles partition roles
// (sonic-config on every switch, metal-core on the leaves, mgmt-server,
// dhcp, metal-bmc, pixiecore and image-cache on the management servers).
// Variable names are checked against model/ansibleRoles.ts by the tests.

const PXE_VLAN = 4000
const PORTS_NOTE =
  'Port layout (sonic_config_breakouts, sonic_config_ports) depends on the\nswitch model and the cabling, which the planner does not model yet.'

function netmask(prefix: number): string {
  const all = (1n << 32n) - 1n
  return formatIp(4, all ^ ((1n << BigInt(32 - prefix)) - 1n))
}

const cidrs = (list: Cidr[]) => list.map(formatCidr)

/** A central-rack or rack switch that runs BGP (loopback and ASN). */
function isBgpSpeaker(d: Device, l3: boolean): boolean {
  if (d.role === 'mgmt-spine' || d.role === 'mgmt-leaf') return l3
  return d.role !== 'router' && d.role !== 'mgmt-server'
}

export function groupVarFiles({ plan, devices, addresses, out }: AnsibleContext): void {
  const inv = out.inventory
  const dep = plan.deployment
  const file = (group: string, topic: string, entries: (YEntry | false)[], header?: string) =>
    out.add(`${inv}/group_vars/${group}/${topic}.yaml`, toYaml(ymap(...entries), header))

  // Release vector (mirrors mini-lab's group_vars/all/release_vector.yaml).
  {
    const f = `${inv}/group_vars/all/release_vector.yaml`
    out.add(
      f,
      toYaml(
        ymap(
          kv(
            'metal_stack_release_version',
            dep.metalStackRelease ||
              out.todo(
                f,
                'metal_stack_release_version',
                'metal-stack release to deploy (Ansible tab)',
              ),
          ),
          kv('metal_stack_release_vectors', [
            ymap(
              kv('url', 'oci://ghcr.io/metal-stack/releases:{{ metal_stack_release_version }}'),
              kv('variable_mapping_path', 'metal_stack_release.mapping'),
              kv('include_role_defaults', 'metal-roles/common/roles/defaults'),
            ),
          ]),
        ),
        'Image names and tags of the roles come from the metal-stack release vector.\nAdd oci_cosign_verify_key to the vector entry to verify its signature.',
      ),
    )
  }

  // Settings shared by the whole partition inventory.
  {
    const f = `${inv}/group_vars/partition/switches.yaml`
    const list = (key: string, values: string[], what: string) =>
      values.length ? values : [out.todo(f, key, `${what} (Ansible tab)`)]
    file('partition', 'switches', [
      kv('sonic_config_mgmt_vrf', true),
      kv('sonic_config_timezone', dep.timezone),
      kv(
        'sonic_config_nameservers',
        list('sonic_config_nameservers', dep.nameservers, 'name servers'),
      ),
      kv(
        'sonic_config_ntp',
        ymap(kv('servers', list('sonic_config_ntp', dep.ntpServers, 'NTP servers'))),
      ),
      kv('sonic_config_ssh_sourceranges', dep.sshSourceRanges),
    ])
  }
  {
    const f = `${inv}/group_vars/partition/metal.yaml`
    file(
      'partition',
      'metal',
      [
        kv('metal_partition_timezone', dep.timezone),
        kv(
          'metal_partition_metal_api_addr',
          dep.metalApiAddress.trim() ||
            out.todo(
              f,
              'metal_partition_metal_api_addr',
              'address of the control plane metal-api (Ansible tab)',
            ),
        ),
      ],
      'Connection to the metal-stack control plane (partition/roles/defaults).',
    )
  }
  {
    const f = `${inv}/group_vars/partition/secrets.yaml`
    const secret = (key: string, what: string) => kv(key, out.todo(f, key, what))
    file(
      'partition',
      'secrets',
      [
        secret('metal_partition_metal_api_hmac_edit_key', 'metal-api HMAC edit key'),
        secret('metal_partition_metal_api_hmac_view_key', 'metal-api HMAC view key'),
        secret('metal_partition_metal_api_grpc_ca_cert', 'metal-api gRPC CA certificate'),
        secret('metal_partition_metal_api_grpc_client_cert', 'metal-api gRPC client certificate'),
        secret('metal_partition_metal_api_grpc_client_key', 'metal-api gRPC client key'),
        secret('metal_bmc_bmc_superuser', 'BMC superuser name'),
        secret('metal_bmc_bmc_superuser_pwd', 'BMC superuser password'),
        secret('metal_bmc_nsqd_ca_cert', 'NSQ CA certificate'),
        secret('metal_bmc_nsqd_client_cert', 'NSQ client certificate'),
        secret('metal_bmc_nsqd_client_cert_key', 'NSQ client key'),
        secret('metal_bmc_console_ca_cert', 'console CA certificate'),
        secret('metal_bmc_console_cert', 'console certificate'),
        secret('metal_bmc_console_key', 'console key'),
        secret('mgmt_server_metal_ssh_privkey', 'SSH private key of the metal admin user'),
        secret('mgmt_server_metal_ssh_pubkey', 'SSH public key of the metal admin user'),
      ],
      'Secrets: fill in and encrypt this file with ansible-vault before committing it.',
    )
  }

  devices.forEach((p, i) =>
    partitionGroupVars(
      p,
      addresses[i],
      plan.partitions[i].fabric.mgmt.layer === 'l3',
      file,
      out,
      dep,
    ),
  )
}

function partitionGroupVars(
  p: PartitionDevices,
  addr: PartitionAddresses,
  l3: boolean,
  file: (group: string, topic: string, entries: (YEntry | false)[], header?: string) => void,
  out: AnsibleContext['out'],
  dep: AnsibleContext['plan']['deployment'],
): void {
  const inv = out.inventory
  const has = (role: Device['role']) => devicesOf(p, role).length > 0
  const central = addr.mgmtSubnets.find((s) => !s.rackId)
  const gw = (s: { gateway: bigint } | undefined, f: string) =>
    s ? formatIp(4, s.gateway) : out.todo(f, 'metal_partition_mgmt_gateway', 'management gateway')

  {
    const f = `${inv}/group_vars/${p.group}/partition.yaml`
    file(
      p.group,
      'partition',
      [
        kv('metal_partition_id', p.slug),
        kv(
          'metal_partition_mgmt_gateway',
          gw(central, f),
          l3 ? 'Gateway of the central management network.' : 'Gateway of the management network.',
        ),
      ],
      p.partitionName,
    )
  }

  const bgpPorts = (group: string, what: string): YEntry => {
    const f = `${inv}/group_vars/${group}/sonic.yaml`
    return kv('sonic_config_bgp_ports', [out.todo(f, 'sonic_config_bgp_ports', what)])
  }

  if (has('leaf')) {
    const g = partitionGroup(p, 'leaf')
    file(g, 'sonic', [
      kv(
        'lo',
        '{{ sonic_config_loopback_address }}',
        'metal-core reads the loopback and the ASN as lo / asn.',
      ),
      kv('asn', '{{ sonic_config_asn }}'),
      kv(
        'sonic_config_frr_render',
        false,
        'metal-core writes frr.conf, which needs the split routing mode.',
      ),
      kv('sonic_config_docker_routing_config_mode', 'split'),
      kv('sonic_config_frr_l2vpn_evpn', true),
      bgpPorts(g, 'spine-facing ports of the leaves'),
      note(PORTS_NOTE),
    ])
    for (const rack of p.racks) {
      if (!p.devices.some((d) => d.role === 'leaf' && d.rack?.rackId === rack.rackId)) continue
      const rg = rackGroup(p, rack.tag)
      const f = `${inv}/group_vars/${rg}/rack.yaml`
      const rackSubnet = addr.mgmtSubnets.find((s) => s.rackId === rack.rackId)
      file(
        rg,
        'rack',
        [
          kv('metal_core_rack_id', `${p.slug}-rack${String(rack.number).padStart(2, '0')}`),
          kv('metal_core_spine_uplinks', [
            out.todo(
              f,
              'metal_core_spine_uplinks',
              `spine-facing ports of the leaves in ${rack.name}`,
            ),
          ]),
          l3 &&
            kv(
              'metal_partition_mgmt_gateway',
              gw(rackSubnet, f),
              "The rack's management network, routed by its mgmt leaf.",
            ),
        ],
        rack.name,
      )
    }
  }

  for (const role of ['spine', 'superspine', 'storage-leaf'] as const) {
    if (!has(role)) continue
    const g = partitionGroup(p, role)
    file(g, 'sonic', [
      kv('sonic_config_frr_l2vpn_evpn', true),
      bgpPorts(
        g,
        role === 'spine'
          ? 'leaf- and exit-facing ports of the spines'
          : `spine-facing ports of the ${role}s`,
      ),
      note(PORTS_NOTE),
    ])
  }
  if (has('exit')) {
    const g = partitionGroup(p, 'exit')
    file(g, 'sonic', [
      kv('sonic_config_frr_l2vpn_evpn', true),
      kv(
        'sonic_config_vtep',
        ymap(kv('enabled', true)),
        'Exits terminate the external networks as VTEPs.',
      ),
      bgpPorts(g, 'spine-facing ports of the exits'),
      note(
        "Upstream peerings to the internet routers (sonic_config_interconnects) are\nindividual; the transfer networks are listed in each exit's host_vars.",
      ),
      note(PORTS_NOTE),
    ])
  }
  for (const role of ['mgmt-spine', 'mgmt-leaf'] as const) {
    if (!has(role)) continue
    const g = partitionGroup(p, role)
    file(
      g,
      'sonic',
      l3
        ? [
            kv('sonic_config_frr_l2vpn_evpn', false),
            bgpPorts(g, `uplink ports of the ${role}s`),
            note(PORTS_NOTE),
          ]
        : [
            kv('sonic_config_frr_render', false, 'L2 management network: switching only, no BGP.'),
            note(PORTS_NOTE),
          ],
    )
  }

  if (has('mgmt-server')) {
    const g = partitionGroup(p, 'mgmt-server')
    const f = (topic: string) => `${inv}/group_vars/${g}/${topic}.yaml`
    file(g, 'mgmt-server', [
      kv(
        'mgmt_server_spine_facing_interface',
        out.todo(
          f('mgmt-server'),
          'mgmt_server_spine_facing_interface',
          'NIC of the mgmt server towards the mgmt spines',
        ),
      ),
      kv(
        'mgmt_server_firewall_facing_interface',
        out.todo(
          f('mgmt-server'),
          'mgmt_server_firewall_facing_interface',
          'NIC of the mgmt server towards the mgmt firewall',
        ),
      ),
      dep.nameservers.length > 0 && kv('mgmt_server_nameservers', dep.nameservers),
    ])
    const subnets: YValue[] = addr.mgmtSubnets
      .filter((s) => s.dhcpRange)
      .map((s) =>
        ymap(
          kv('comment', `BMCs, ${s.scope}`),
          kv('network', formatIp(4, s.cidr.addr)),
          kv('netmask', netmask(s.cidr.prefix)),
          kv(
            'range',
            ymap(
              kv('begin', formatIp(4, s.dhcpRange![0])),
              kv('end', formatIp(4, s.dhcpRange![1])),
            ),
          ),
          kv('options', [`routers ${formatIp(4, s.gateway)}`]),
        ),
      )
    file(
      g,
      'dhcp',
      [kv('dhcp_subnets', subnets)],
      'BMC addresses: the management subnets after the gateway and the switches.',
    )
    file(g, 'metal-bmc', [
      kv('metal_bmc_allowed_cidrs', cidrs(addr.mgmtSubnets.map((s) => s.cidr))),
      kv(
        'metal_bmc_nsqd_addr',
        out.todo(
          f('metal-bmc'),
          'metal_bmc_nsqd_addr',
          'NSQ daemon of the control plane (host:port)',
        ),
      ),
    ])
    file(g, 'pixiecore', [
      kv(
        'pixiecore_api_host',
        out.todo(f('pixiecore'), 'pixiecore_api_host', 'address pixiecore serves the PXE API on'),
      ),
      dep.nameservers.length > 0 && kv('pixiecore_dns_servers', dep.nameservers),
      dep.ntpServers.length > 0 && kv('pixiecore_metal_hammer_ntp_servers', dep.ntpServers),
    ])
    file(g, 'image-cache', [
      kv('image_cache_sync_metal_api_view_hmac', '{{ metal_partition_metal_api_hmac_view_key }}'),
    ])
  }
}

export function hostVarFiles({ plan, devices, addresses, out }: AnsibleContext): void {
  devices.forEach((p, i) => {
    const addr = addresses[i]
    const l3 = plan.partitions[i].fabric.mgmt.layer === 'l3'
    for (const d of p.devices) {
      const f = `${out.inventory}/host_vars/${d.hostname}.yaml`
      const a = addr.byHost.get(d.hostname)!
      const transfers = addr.transfers.filter(
        (t) => t.exit === d.hostname || t.router === d.hostname,
      )
      const transferNote =
        transfers.length > 0 &&
        note(
          'Transfer networks (router ↔ exit):\n' +
            transfers
              .map(
                (t) =>
                  `  ${formatCidr(t.cidr)}  ${t.exit} ${t.exitIp}, ${t.router} ${t.routerIp} (link ${t.link})`,
              )
              .join('\n'),
        )
      const entries: (YEntry | false)[] = []

      if (d.role === 'router') {
        entries.push(
          note('Internet router: no metal-roles role configures it; listed for reference.'),
          transferNote,
        )
      } else {
        entries.push(
          kv(
            'ansible_host',
            a.mgmt?.ip ??
              out.todo(f, 'ansible_host', 'management address (the subnet is not placed)'),
          ),
        )
        if (d.role === 'mgmt-server') {
          entries.push(
            kv('mgmt_server_asn', d.asn ?? 0),
            kv(
              'mgmt_server_router_id',
              (l3 ? a.loopback : a.mgmt?.ip) ??
                out.todo(f, 'mgmt_server_router_id', 'router id of the mgmt server'),
            ),
          )
        } else {
          if (isBgpSpeaker(d, l3)) {
            entries.push(
              kv('sonic_config_asn', d.asn ?? 0),
              kv(
                'sonic_config_loopback_address',
                a.loopback ??
                  out.todo(f, 'sonic_config_loopback_address', 'loopback (the pool is not placed)'),
              ),
            )
          }
          entries.push(
            a.mgmt
              ? kv(
                  'sonic_config_mgmt_interface',
                  ymap(
                    kv('ip', `${a.mgmt.ip}/${a.mgmt.prefix}`),
                    kv('gateway_address', a.mgmt.gateway),
                  ),
                )
              : note('No management address: the management subnet is not placed.'),
          )
        }
        if (d.role === 'leaf') {
          entries.push(
            kv(
              'metal_core_cidr',
              a.pxe ?? out.todo(f, 'metal_core_cidr', 'PXE network of the leaf (see the IPs tab)'),
              "The leaf's address in its own PXE network.",
            ),
          )
        }
        if (d.role === 'exit' && a.pxe) {
          entries.push(
            kv(
              'sonic_config_vlans',
              [ymap(kv('id', PXE_VLAN), kv('ip', a.pxe))],
              'PXE network of the exits.',
            ),
          )
        }
        if (d.role === 'mgmt-leaf' && l3) {
          const s = addr.mgmtSubnets.find((m) => m.rackId === d.rack?.rackId)
          if (s) {
            entries.push(
              note(
                `Routes ${formatCidr(s.cidr)} for ${d.rack!.name}: gateway ${formatIp(4, s.gateway)}` +
                  (s.dhcpRange
                    ? `, BMC range ${formatIp(4, s.dhcpRange[0])} to ${formatIp(4, s.dhcpRange[1])}.`
                    : '.'),
              ),
            )
          }
        }
        entries.push(transferNote)
      }
      out.add(
        f,
        toYaml(ymap(...entries.filter((e): e is YEntry => !!e)), `${d.hostname} (${d.role})`),
      )
    }
  })
}
