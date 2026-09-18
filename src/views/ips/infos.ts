import { DOCS, type Info } from '../plan/docs'

// Info-bubble texts of the IPs tab. Statements about metal-stack follow the
// linked docs; planning conventions of this tool are marked as such.
export const IP_INFO = {
  tab: {
    text: 'Plans the address ranges of a metal-stack setup: public internet ranges, the partition super networks that project networks are carved from, the Kubernetes pod and service ranges of shoot and seed clusters, and the infrastructure ranges of each partition. Everything below the inputs is derived from them and from the plan.',
  },
  internet: {
    text: 'Public ranges of the setup. IPv4 traffic from a tenant network leaves through its firewall and is masqueraded. In this plan, IPv6 project networks are taken from the internet range, so they are reachable without NAT.',
    href: DOCS.networking,
  },
  tenantPrefix: {
    text: 'Prefix handed to one tenant from the IPv6 internet ranges. /64 is the smallest network SLAAC works with.',
  },
  projectCidr: {
    text: 'Range the partition super networks are carved from. A project owns one or more private networks, each routed in its own VRF.',
    href: DOCS.networkSegmentation,
  },
  partitionPrefix: {
    text: 'Each partition gets one super network of this size from the project CIDR, and its project networks are carved from it. Slots that overlap Kubernetes, reserve, internet or infrastructure ranges are skipped.',
    href: DOCS.architecture,
  },
  projectPrefix: {
    text: 'Size of one project network: the private network the machines of a cluster get their addresses from. The docs use a /22 tenant network as example.',
    href: DOCS.networking,
  },
  frrListenRange: {
    text: 'FRR on every machine accepts iBGP sessions from this range, so pods such as metal-lb with addresses in it can peer with FRR. The pod ranges should lie inside it.',
    href: DOCS.networking,
  },
  gardener: {
    text: 'Pod and service ranges of the shoot (tenant) clusters and of the seed that runs their control planes. Shoot and seed ranges must not overlap because of the VPN between shoot and seed.',
  },
  reserve: {
    text: 'Ranges kept free for later, for example to grow the seed pod range. They count as used when partition slots are allocated.',
  },
  nodePodPrefix: {
    text: 'Pod range each worker gets from the pod CIDR. It limits the workers per cluster (pod CIDR ÷ per-node range) and the pods per worker; the suggested max-pods is half of a worker’s pod IPs.',
  },
  ula: {
    text: 'Unique local addresses (RFC 4193) for IPv6 pods and services. A random 40-bit global ID keeps the /48 unique; the presets encode metal-stack in fd8e:7a15:7ac6::/48.',
  },
  infra: {
    text: 'Per-partition ranges of the switch plane: underlay loopbacks (BGP router ID and VTEP address of every switch and firewall), the PXE VLAN (one network per leaf, its metal-core CIDR, plus one for the exit switch SVIs), the management network (mgmt VRF with every switch management interface and every BMC), the management loopbacks of an L3 management network, and the transfer networks to the upstream routers.',
    href: DOCS.networking,
  },
  headroom: {
    text: 'Extra addresses on top of today’s device count, so racks and machines can be added without renumbering. Transfer networks are sized exactly.',
  },
  firewalls: {
    text: 'Firewalls are ordinary machines running FRR as EVPN-to-the-host VTEPs, one per group of tenant servers; each needs an underlay loopback.',
    href: DOCS.networkSegmentation,
  },
  transfer: {
    text: 'Exit switches peer with upstream routers using numbered BGP; each router ↔ exit link gets its own transfer network.',
    href: DOCS.networkSegmentation,
  },
  bmc: {
    text: 'BMC addresses are leased by DHCP; metal-bmc reports them to the metal-api and gives access to power, console and firmware.',
    href: DOCS.metalBmc,
  },
} satisfies Record<string, Info>
