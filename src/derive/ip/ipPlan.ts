import type { IpFamily, IpFamilyKey, IpInfra } from '../../model/ipPlan'
import { mgmtDeviceCount, type Partition, type Plan } from '../../model/plan'
import { partitionNodes, rackNodes } from '../nodes'
import {
  contains,
  fitPrefix,
  formatCount,
  lastAddr,
  overlaps,
  parseCidr,
  pow2,
  size,
  subnet,
  subnetCount,
  WIDTH,
  type Cidr,
  type CidrResult,
  type Family,
} from './cidr'

// Derives the address plan from Plan.ipPlan: limits per address family
// (the rows of the address-planning spreadsheet), one super network per
// plan partition, an example cluster, and the infrastructure ranges sized
// from the plan's devices. Like the BOM, all of this is derived, never
// stored.
//
// Infrastructure sizing (IPv4; metal-stack runs BGP unnumbered with IPv4
// loopbacks, see the networking docs):
// - Underlay: one loopback per BGP speaker — used as router ID and VTEP
//   address — for leaves, spines, exits, superspines, storage leaves and
//   firewalls (EVPN-to-the-host VTEPs).
// - PXE (vlan4000): one address per server node plus one per exit switch,
//   whose SVI runs the PXE DHCP server.
// - Management (mgmt VRF / out-of-band): one per switch management
//   interface (production and management switches), one BMC per server
//   node, management server and internet router, and each management
//   server's own interface. L2 management: one subnet per partition; L3:
//   a central subnet plus one per compute rack (a rack group once).
// - Transfer networks: one per router ↔ exit link (2 × routers × exits).
// Host subnets reserve 3 addresses (network, broadcast, gateway), the
// loopback pool none. Every size except the transfer networks gets the
// growth headroom; subnets are packed largest first, so they stay aligned.

export const FAMILY_OF: Record<IpFamilyKey, Family> = { ipv4: 4, ipv6: 6 }

export const CIDR_FIELDS = [
  'projectCidr',
  'frrListenRange',
  'shootPodCidr',
  'shootServiceCidr',
  'seedPodCidr',
  'seedServiceCidr',
] as const
export type CidrField = (typeof CIDR_FIELDS)[number]

export const CIDR_FIELD_LABEL: Record<CidrField, string> = {
  projectCidr: 'Project CIDR',
  frrListenRange: 'FRR listen range',
  shootPodCidr: 'Shoot pod CIDR',
  shootServiceCidr: 'Shoot service CIDR',
  seedPodCidr: 'Seed pod CIDR',
  seedServiceCidr: 'Seed service CIDR',
}

export type MetricId =
  | 'publicAddresses'
  | 'maxTenants'
  | 'partitionSlots'
  | 'usableSlots'
  | 'projectNetworksPerPartition'
  | 'projectNetworksPlan'
  | 'addressesPerProjectNetwork'
  | 'maxShootWorkers'
  | 'maxSeedWorkers'
  | 'podIpsPerWorker'
  | 'maxPods'
  | 'shootServices'
  | 'seedServices'

export const METRIC_LABEL: Record<MetricId, string> = {
  publicAddresses: 'Public addresses',
  maxTenants: 'Max tenants',
  partitionSlots: 'Partition slots',
  usableSlots: 'Usable partition slots',
  projectNetworksPerPartition: 'Project networks per partition',
  projectNetworksPlan: 'Project networks, whole plan',
  addressesPerProjectNetwork: 'Addresses per project network',
  maxShootWorkers: 'Max workers per shoot cluster',
  maxSeedWorkers: 'Max seed workers',
  podIpsPerWorker: 'Pod IPs per worker',
  maxPods: 'Suggested max-pods per worker',
  shootServices: 'Services per shoot cluster',
  seedServices: 'Services per seed',
}

export interface Metric {
  id: MetricId
  value: bigint | null
  /** How the value came about, e.g. "2^(22 − 18) = 16"; or why it is missing. */
  formula: string
}

export interface PartitionAllocation {
  partitionId: string
  partitionName: string
  cidr: Cidr | null
}

export interface ExampleCluster {
  partitionName: string
  superNetwork: Cidr
  projectNetwork: Cidr
  nodeAddresses: bigint[]
  nodePodCidrs: Cidr[]
  shootPodCidr: Cidr
  shootServiceCidr: Cidr
  firstServiceAddress: bigint
  seedPodCidr: Cidr
  seedServiceCidr: Cidr
  reserveCidrs: Cidr[]
}

export interface FamilyResult {
  key: IpFamilyKey
  family: Family
  enabled: boolean
  input: IpFamily
  /** Parse result per field: CIDR_FIELDS plus "internetCidrs.<i>" / "reserveCidrs.<i>". */
  parsed: Record<string, CidrResult>
  metrics: Record<MetricId, Metric>
  /** Ranges that make partition slots unusable (Kubernetes, reserve, internet, infra). */
  blocking: { label: string; cidr: Cidr }[]
  allocations: PartitionAllocation[]
  example: ExampleCluster | null
}

export interface InfraSubnet {
  purpose: string
  scope: string
  /** Devices / addresses needed today. */
  needed: number
  /** Addresses the subnet is sized for (needed + headroom + reserved). */
  sized: number
  prefix: number
  cidr: Cidr | null
  detail: string
}

export interface InfraPartition {
  partitionId: string
  partitionName: string
  block: Cidr | null
  subnets: InfraSubnet[]
  usedAddresses: bigint
  /** Block prefix that would hold all subnets. */
  requiredPrefix: number
  overflow: boolean
}

export interface InfraResult {
  input: IpInfra
  parsed: CidrResult
  blocks: bigint | null
  partitions: InfraPartition[]
}

export interface IpPlanResult {
  ipv4: FamilyResult
  ipv6: FamilyResult
  infra: InfraResult
}

const ok = (r: CidrResult | undefined): Cidr | null => (r && r.ok ? r.cidr : null)

function metric(id: MetricId, value: bigint | null, formula: string): Metric {
  return { id, value, formula }
}

const missing = (id: MetricId, why = 'needs valid inputs'): Metric => metric(id, null, why)

/** Merged intervals of slot indices [start, end] blocked by the ranges. */
function blockedSlotIntervals(
  project: Cidr,
  slotPrefix: number,
  ranges: Cidr[],
): [bigint, bigint][] {
  const shift = BigInt(WIDTH[project.family] - slotPrefix)
  const projectEnd = lastAddr(project)
  const intervals = ranges
    .filter((r) => overlaps(r, project))
    .map((r): [bigint, bigint] => {
      const start = r.addr > project.addr ? r.addr : project.addr
      const end = lastAddr(r) < projectEnd ? lastAddr(r) : projectEnd
      return [(start - project.addr) >> shift, (end - project.addr) >> shift]
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const merged: [bigint, bigint][] = []
  for (const iv of intervals) {
    const last = merged[merged.length - 1]
    if (last && iv[0] <= last[1] + 1n) {
      if (iv[1] > last[1]) last[1] = iv[1]
    } else merged.push([iv[0], iv[1]])
  }
  return merged
}

function deriveFamily(
  key: IpFamilyKey,
  input: IpFamily,
  enabled: boolean,
  plan: Plan,
  infraCidr: Cidr | null,
): FamilyResult {
  const family = FAMILY_OF[key]
  const W = WIDTH[family]
  const parsed: Record<string, CidrResult> = {}
  for (const f of CIDR_FIELDS) parsed[f] = parseCidr(input[f], family)
  input.internetCidrs.forEach((s, i) => (parsed[`internetCidrs.${i}`] = parseCidr(s, family)))
  input.reserveCidrs.forEach((s, i) => (parsed[`reserveCidrs.${i}`] = parseCidr(s, family)))

  const project = ok(parsed.projectCidr)
  const shootPod = ok(parsed.shootPodCidr)
  const shootSvc = ok(parsed.shootServiceCidr)
  const seedPod = ok(parsed.seedPodCidr)
  const seedSvc = ok(parsed.seedServiceCidr)
  const internet = input.internetCidrs.map((_, i) => ok(parsed[`internetCidrs.${i}`]))
  const reserves = input.reserveCidrs.map((_, i) => ok(parsed[`reserveCidrs.${i}`]))
  const validInternet = internet.filter((c): c is Cidr => !!c)
  const validReserves = reserves.filter((c): c is Cidr => !!c)
  const partitions = plan.partitions.length
  const { partitionPrefix: pp, projectPrefix: prj, nodePodPrefix: npp, tenantPrefix } = input

  const m = {} as Record<MetricId, Metric>

  // Internet.
  if (family === 4) {
    const total = validInternet.reduce((n, c) => n + size(c), 0n)
    m.publicAddresses = metric(
      'publicAddresses',
      total,
      validInternet.length > 0
        ? `Σ 2^(32 − p) over ${validInternet.length} ranges = ${formatCount(total)}`
        : 'no internet ranges',
    )
    m.maxTenants = missing('maxTenants', 'n/a (IPv4 tenants share the internet network)')
  } else {
    const fitting = validInternet.filter((c) => c.prefix <= tenantPrefix)
    const tenants = fitting.reduce((n, c) => n + subnetCount(c, tenantPrefix), 0n)
    m.maxTenants =
      fitting.length > 0
        ? metric(
            'maxTenants',
            tenants,
            fitting.length === 1
              ? `2^(${tenantPrefix} − ${fitting[0].prefix}) = ${formatCount(tenants)}`
              : `Σ 2^(${tenantPrefix} − p) over ${fitting.length} ranges = ${formatCount(tenants)}`,
          )
        : missing('maxTenants')
    m.publicAddresses = metric(
      'publicAddresses',
      validInternet.reduce((n, c) => n + size(c), 0n),
      `Σ 2^(128 − p) over ${validInternet.length} ranges`,
    )
  }

  // Blocking ranges for partition slots.
  const blocking: { label: string; cidr: Cidr }[] = []
  const pushBlock = (label: string, c: Cidr | null) => c && blocking.push({ label, cidr: c })
  pushBlock('Shoot pod CIDR', shootPod)
  pushBlock('Shoot service CIDR', shootSvc)
  pushBlock('Seed pod CIDR', seedPod)
  pushBlock('Seed service CIDR', seedSvc)
  validReserves.forEach((c, i) => pushBlock(`Reserve ${i + 1}`, c))
  validInternet.forEach((c, i) => pushBlock(`Internet ${i + 1}`, c))
  if (family === 4) pushBlock('Infrastructure CIDR', infraCidr)

  // Project networks and partitions.
  const allocations: PartitionAllocation[] = plan.partitions.map((p) => ({
    partitionId: p.id,
    partitionName: p.name,
    cidr: null,
  }))
  const slotsValid = project && project.prefix <= pp && pp <= W
  if (slotsValid) {
    const slots = subnetCount(project, pp)
    m.partitionSlots = metric(
      'partitionSlots',
      slots,
      `2^(${pp} − ${project.prefix}) = ${formatCount(slots)}`,
    )
    const intervals = blockedSlotIntervals(
      project,
      pp,
      blocking
        // An internet range holding the whole project CIDR is by design (IPv6
        // project networks are carved from the internet range), not a clash.
        .filter(
          (b) =>
            overlaps(b.cidr, project) &&
            !(b.label.startsWith('Internet') && contains(b.cidr, project)),
        )
        .map((b) => b.cidr),
    )
    const blocked = intervals.reduce((n, [a, b]) => n + (b - a + 1n), 0n)
    const usable = slots - blocked
    m.usableSlots = metric(
      'usableSlots',
      usable,
      blocked > 0n
        ? `${formatCount(slots)} slots − ${formatCount(blocked)} overlapping other ranges = ${formatCount(usable)}`
        : `all ${formatCount(slots)} slots are free of other ranges`,
    )
    // Sequential allocation, skipping blocked slots.
    let index = 0n
    let next = 0
    for (const iv of intervals.concat([[slots, slots]])) {
      while (next < allocations.length && index < iv[0] && index < slots) {
        allocations[next++].cidr = subnet(project, pp, index++)
      }
      if (index <= iv[1]) index = iv[1] + 1n
      if (next >= allocations.length) break
    }
  } else {
    m.partitionSlots = missing('partitionSlots')
    m.usableSlots = missing('usableSlots')
  }
  if (slotsValid && pp <= prj && prj <= W) {
    const per = pow2(prj - pp)
    m.projectNetworksPerPartition = metric(
      'projectNetworksPerPartition',
      per,
      `2^(${prj} − ${pp}) = ${formatCount(per)}`,
    )
    m.projectNetworksPlan = metric(
      'projectNetworksPlan',
      per * BigInt(partitions),
      `${partitions} partition${partitions === 1 ? '' : 's'} × ${formatCount(per)} = ${formatCount(per * BigInt(partitions))}`,
    )
  } else {
    m.projectNetworksPerPartition = missing('projectNetworksPerPartition')
    m.projectNetworksPlan = missing('projectNetworksPlan')
  }
  m.addressesPerProjectNetwork =
    prj <= W
      ? metric(
          'addressesPerProjectNetwork',
          pow2(W - prj),
          `2^(${W} − ${prj}) = ${formatCount(pow2(W - prj))}`,
        )
      : missing('addressesPerProjectNetwork')

  // Kubernetes.
  const workers = (pod: Cidr | null, id: MetricId) =>
    pod && pod.prefix <= npp && npp <= W
      ? metric(
          id,
          pow2(npp - pod.prefix),
          `2^(${npp} − ${pod.prefix}) = ${formatCount(pow2(npp - pod.prefix))}`,
        )
      : missing(id)
  m.maxShootWorkers = workers(shootPod, 'maxShootWorkers')
  m.maxSeedWorkers = workers(seedPod, 'maxSeedWorkers')
  if (npp <= W) {
    const podIps = pow2(W - npp)
    m.podIpsPerWorker = metric(
      'podIpsPerWorker',
      podIps,
      `2^(${W} − ${npp}) = ${formatCount(podIps)}`,
    )
    m.maxPods = metric(
      'maxPods',
      podIps / 2n,
      `${formatCount(podIps)} / 2 = ${formatCount(podIps / 2n)}`,
    )
  } else {
    m.podIpsPerWorker = missing('podIpsPerWorker')
    m.maxPods = missing('maxPods')
  }
  const services = (svc: Cidr | null, id: MetricId) =>
    svc
      ? metric(id, size(svc), `2^(${W} − ${svc.prefix}) = ${formatCount(size(svc))}`)
      : missing(id)
  m.shootServices = services(shootSvc, 'shootServices')
  m.seedServices = services(seedSvc, 'seedServices')

  // Example cluster in the first partition: its first project network,
  // the first node addresses and per-node pod ranges.
  let example: ExampleCluster | null = null
  const first = allocations[0]
  const exampleValid =
    first?.cidr && shootPod && shootSvc && seedPod && seedSvc && pp <= prj && prj < W
  if (exampleValid && shootPod.prefix <= npp && npp <= W) {
    const projectNetwork = subnet(first.cidr!, prj, 0n)
    const hosts = pow2(W - prj) - 2n // without network and broadcast
    const nodeCount = hosts < 3n ? Math.max(0, Number(hosts)) : 3
    const podRanges = subnetCount(shootPod, npp) < 3n ? Number(subnetCount(shootPod, npp)) : 3
    example = {
      partitionName: first.partitionName,
      superNetwork: first.cidr!,
      projectNetwork,
      nodeAddresses: Array.from(
        { length: nodeCount },
        (_, i) => projectNetwork.addr + BigInt(i + 1),
      ),
      nodePodCidrs: Array.from({ length: podRanges }, (_, i) => subnet(shootPod, npp, BigInt(i))),
      shootPodCidr: shootPod,
      shootServiceCidr: shootSvc,
      firstServiceAddress: shootSvc.addr + 1n,
      seedPodCidr: seedPod,
      seedServiceCidr: seedSvc,
      reserveCidrs: validReserves,
    }
  }

  return { key, family, enabled, input, parsed, metrics: m, blocking, allocations, example }
}

// --- Infrastructure --------------------------------------------------------

const HOST_RESERVED = 3

function withHeadroom(needed: number, headroomPercent: number): number {
  return Math.ceil((needed * (100 + headroomPercent)) / 100)
}

function hostSubnet(
  purpose: string,
  scope: string,
  needed: number,
  detail: string,
  infra: IpInfra,
  reserved = HOST_RESERVED,
): InfraSubnet | null {
  if (needed <= 0) return null
  const sized = withHeadroom(needed, infra.headroomPercent) + reserved
  return { purpose, scope, needed, sized, prefix: fitPrefix(4, sized), cidr: null, detail }
}

/** Subnets a partition needs, in display order, not yet placed. */
export function partitionInfraNeeds(partition: Partition, infra: IpInfra): InfraSubnet[] {
  const { fabric } = partition
  const leaves = partition.racks.reduce((n, r) => n + r.leafCount, 0)
  const superspines = fabric.fabricType === 'leaf-spine-superspine' ? fabric.superspineCount : 0
  const mgmtCount = mgmtDeviceCount(fabric.mgmt)
  const mgmtLeaves = fabric.mgmt.leafPerRack * partition.racks.length
  const nodes = partitionNodes(partition).total
  const out: (InfraSubnet | null)[] = []

  const speakers =
    leaves + fabric.spineCount + fabric.exitSwitchCount + superspines + fabric.storageLeafCount
  out.push(
    hostSubnet(
      'Underlay loopbacks',
      'Partition',
      speakers + infra.firewallsPerPartition,
      `${leaves} leaves + ${fabric.spineCount} spines + ${fabric.exitSwitchCount} exits` +
        (superspines ? ` + ${superspines} superspines` : '') +
        (fabric.storageLeafCount ? ` + ${fabric.storageLeafCount} storage leaves` : '') +
        ` + ${infra.firewallsPerPartition} firewalls`,
      infra,
      0,
    ),
  )
  out.push(
    hostSubnet(
      'PXE (vlan4000)',
      'Partition',
      nodes + fabric.exitSwitchCount,
      `${nodes} server nodes + ${fabric.exitSwitchCount} exit SVIs`,
      infra,
    ),
  )

  const centralSwitches =
    fabric.spineCount + fabric.exitSwitchCount + superspines + fabric.storageLeafCount + mgmtCount
  const centralServers = 2 * mgmtCount + fabric.routerCount
  const centralDetail =
    `${centralSwitches} central switch mgmt interfaces + ${mgmtCount} mgmt servers × 2 (BMC, interface)` +
    (fabric.routerCount ? ` + ${fabric.routerCount} router BMCs` : '')
  if (fabric.mgmt.layer === 'l2') {
    out.push(
      hostSubnet(
        'Management',
        'Partition',
        centralSwitches + centralServers + leaves + mgmtLeaves + nodes,
        `${centralDetail} + ${leaves + mgmtLeaves} rack switch mgmt interfaces + ${nodes} BMCs`,
        infra,
      ),
    )
  } else {
    out.push(
      hostSubnet(
        'Management',
        'Central rack',
        centralSwitches + centralServers,
        centralDetail,
        infra,
      ),
    )
    for (const rack of partition.racks) {
      const rackNodeCount = rackNodes(rack).total
      out.push(
        hostSubnet(
          'Management',
          rack.name,
          rack.leafCount + fabric.mgmt.leafPerRack + rackNodeCount,
          `${rack.leafCount} leaves + ${fabric.mgmt.leafPerRack} mgmt leaf + ${rackNodeCount} BMCs`,
          infra,
        ),
      )
    }
  }

  const links = 2 * fabric.routerCount * fabric.exitSwitchCount
  if (links > 0 && infra.transferPrefix <= 32) {
    const perLink = 2 ** (32 - infra.transferPrefix)
    const total = links * perLink
    out.push({
      purpose: 'Transfer networks',
      scope: 'Partition',
      needed: links,
      sized: total,
      prefix: fitPrefix(4, total),
      cidr: null,
      detail: `${fabric.routerCount} routers × ${fabric.exitSwitchCount} exits × 2 links × /${infra.transferPrefix}`,
    })
  }
  return out.filter((s): s is InfraSubnet => !!s)
}

function deriveInfra(plan: Plan): InfraResult {
  const input = plan.ipPlan.infra
  const parsed = parseCidr(input.cidr, 4)
  const base = ok(parsed)
  const blocksValid = base && base.prefix <= input.partitionPrefix
  const partitions = plan.partitions.map((partition, i): InfraPartition => {
    const subnets = partitionInfraNeeds(partition, input)
    const total = subnets.reduce((n, s) => n + size({ family: 4, addr: 0n, prefix: s.prefix }), 0n)
    const requiredPrefix = fitPrefix(4, Number(total))
    const block =
      blocksValid && BigInt(i) < subnetCount(base, input.partitionPrefix)
        ? subnet(base, input.partitionPrefix, BigInt(i))
        : null
    let overflow = false
    if (block) {
      // Largest first keeps every subnet aligned on its own size.
      const order = [...subnets].sort((a, b) => a.prefix - b.prefix)
      let cursor = block.addr
      const end = lastAddr(block)
      for (const s of order) {
        const c: Cidr = { family: 4, addr: cursor, prefix: s.prefix }
        if (lastAddr(c) > end) {
          overflow = true
          continue
        }
        s.cidr = c
        cursor += size(c)
      }
    }
    return {
      partitionId: partition.id,
      partitionName: partition.name,
      block,
      subnets,
      usedAddresses: total,
      requiredPrefix,
      overflow,
    }
  })
  return {
    input,
    parsed,
    blocks: blocksValid ? subnetCount(base, input.partitionPrefix) : null,
    partitions,
  }
}

export function deriveIpPlan(plan: Plan): IpPlanResult {
  const infra = deriveInfra(plan)
  const infraCidr = ok(infra.parsed)
  const { ipv4, ipv6 } = plan.ipPlan
  return {
    ipv4: deriveFamily('ipv4', ipv4, true, plan, infraCidr),
    ipv6: deriveFamily('ipv6', ipv6, ipv6.enabled, plan, null),
    infra,
  }
}

/** Largest cluster the ranges allow: the smaller of the shoot worker limit
 *  and the addresses of one project network. */
export function largestCluster(f: FamilyResult): { value: bigint; limitedBy: string } | null {
  const workers = f.metrics.maxShootWorkers.value
  const addrs = f.metrics.addressesPerProjectNetwork.value
  if (workers === null || addrs === null) return null
  return workers <= addrs
    ? {
        value: workers,
        limitedBy: `shoot pod CIDR /${ok(f.parsed.shootPodCidr)?.prefix} with /${f.input.nodePodPrefix} per node`,
      }
    : { value: addrs, limitedBy: `project network /${f.input.projectPrefix}` }
}
