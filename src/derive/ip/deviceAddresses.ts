import type { Plan } from '../../model/plan'
import { devicesOf, type Device, type PartitionDevices } from '../devices'
import { rackNodes } from '../nodes'
import { formatCidr, formatIp, lastAddr, size, subnet, type Cidr } from './cidr'
import { pxeSliceCount, type InfraPartition, type InfraSubnet, type IpPlanResult } from './ipPlan'

// Hands out single addresses from the infrastructure subnets that
// deriveIpPlan() sized and placed, one per device of derive/devices.ts.
// Only consumed by the Ansible export; the subnets themselves don't change.
//
// - Loopbacks: the underlay pool in order spines, superspines, exits,
//   storage leaves, leaves; with an L3 management network the management
//   loopback pool in order mgmt spines, mgmt leaves, mgmt servers. Pools
//   start at their second address.
// - Management: in every management subnet the first host is the gateway,
//   the switch management interfaces (and the mgmt servers' own
//   interfaces, in the central or partition subnet) follow in device
//   order, and the rest up to the broadcast address is the DHCP range for
//   the BMCs. L2: one subnet for the partition; L3: the central subnet
//   plus one per rack, whose gateway is the rack's mgmt leaf.
// - PXE: every leaf routes its own PXE network (the metal-core CIDR); the
//   partition's PXE subnet is sized as equal slices for that (see
//   ipPlan.ts): the first for the exit switch SVIs, then one per leaf in
//   rack order, whose first host is the leaf's address.
// - Transfer networks: router r, exit e, link l (two per pair) take the
//   subnet (r · exits + e) · 2 + l; the exit takes the first address, the
//   router the second.
// Whatever does not fit is left null and explained in `notes`.

export interface MgmtAddress {
  ip: string
  prefix: number
  gateway: string
}

export interface DeviceAddresses {
  loopback: string | null
  mgmt: MgmtAddress | null
  /** Leaves: the metal-core CIDR ("10.1.2.1/27"); exits: the PXE SVI. */
  pxe: string | null
}

export interface MgmtSubnet {
  cidr: Cidr
  gateway: bigint
  /** "Central rack", "Partition" or the rack name. */
  scope: string
  rackId?: string
  /** First and last address handed out by DHCP (BMCs), if any are left. */
  dhcpRange: [bigint, bigint] | null
}

export interface TransferLink {
  exit: string
  router: string
  link: number
  cidr: Cidr
  exitIp: string
  routerIp: string
}

export interface PartitionAddresses {
  partitionId: string
  byHost: Map<string, DeviceAddresses>
  mgmtSubnets: MgmtSubnet[]
  /** L3 management: the mgmt loopback pool (the mgmt servers' own network). */
  mgmtLoopbacks: Cidr | null
  pxe: Cidr | null
  transfers: TransferLink[]
  notes: string[]
}

const EMPTY: DeviceAddresses = { loopback: null, mgmt: null, pxe: null }

function partitionAddresses(
  plan: Plan,
  devices: PartitionDevices,
  infra: InfraPartition | undefined,
): PartitionAddresses {
  const partition = plan.partitions.find((p) => p.id === devices.partitionId)!
  const byHost = new Map<string, DeviceAddresses>(
    devices.devices.map((d) => [d.hostname, { ...EMPTY }]),
  )
  const notes: string[] = []
  const name = devices.partitionName
  const set = (d: Device, patch: Partial<DeviceAddresses>) =>
    byHost.set(d.hostname, { ...byHost.get(d.hostname)!, ...patch })
  const find = (kind: InfraSubnet['kind'], rackId?: string): Cidr | null =>
    infra?.subnets.find((s) => s.kind === kind && s.rackId === rackId)?.cidr ?? null
  const role = (r: Device['role']) => devicesOf(devices, r)
  const result: PartitionAddresses = {
    partitionId: devices.partitionId,
    byHost,
    mgmtSubnets: [],
    mgmtLoopbacks: find('mgmt-loopbacks'),
    pxe: find('pxe'),
    transfers: [],
    notes,
  }
  if (!infra?.block) {
    notes.push(`${name}: no infrastructure block, so no device addresses (see the IPs tab).`)
    return result
  }

  // Loopbacks.
  const pool = (cidr: Cidr | null, label: string, list: Device[]) => {
    if (list.length === 0) return
    if (!cidr) {
      notes.push(`${name}: the ${label} pool is not placed, loopbacks are left open.`)
      return
    }
    list.forEach((d, i) => {
      const addr = cidr.addr + 1n + BigInt(i)
      if (addr <= lastAddr(cidr)) set(d, { loopback: formatIp(4, addr) })
    })
    if (BigInt(list.length) + 1n > size(cidr)) {
      notes.push(`${name}: ${formatCidr(cidr)} is too small for ${list.length} ${label}.`)
    }
  }
  pool(find('underlay'), 'underlay loopbacks', [
    ...role('spine'),
    ...role('superspine'),
    ...role('exit'),
    ...role('storage-leaf'),
    ...role('leaf'),
  ])
  const l3 = partition.fabric.mgmt.layer === 'l3'
  if (l3) {
    pool(find('mgmt-loopbacks'), 'management loopbacks', [
      ...role('mgmt-spine'),
      ...role('mgmt-leaf'),
      ...role('mgmt-server'),
    ])
  }

  // Management subnets.
  const mgmtSubnet = (cidr: Cidr | null, scope: string, list: Device[], rackId?: string) => {
    if (!cidr) {
      if (list.length) notes.push(`${name}: the ${scope} management subnet is not placed.`)
      return
    }
    const gateway = cidr.addr + 1n
    const broadcast = lastAddr(cidr)
    list.forEach((d, i) => {
      const addr = gateway + 1n + BigInt(i)
      if (addr < broadcast) {
        set(d, {
          mgmt: { ip: formatIp(4, addr), prefix: cidr.prefix, gateway: formatIp(4, gateway) },
        })
      }
    })
    const first = gateway + 1n + BigInt(list.length)
    const last = broadcast - 1n
    if (first > last)
      notes.push(`${name}: ${formatCidr(cidr)} (${scope}) has no room left for BMCs.`)
    result.mgmtSubnets.push({
      cidr,
      gateway,
      scope,
      rackId,
      dhcpRange: first <= last ? [first, last] : null,
    })
  }
  const central = [
    ...role('superspine'),
    ...role('spine'),
    ...role('exit'),
    ...role('storage-leaf'),
    ...role('mgmt-spine'),
    ...role('mgmt-server'),
  ]
  const rackDevices = (rackId: string) =>
    devices.devices.filter(
      (d) => d.rack?.rackId === rackId && (d.role === 'mgmt-leaf' || d.role === 'leaf'),
    )
  if (l3) {
    mgmtSubnet(find('mgmt'), 'Central rack', central)
    for (const rack of devices.racks) {
      mgmtSubnet(find('mgmt', rack.rackId), rack.name, rackDevices(rack.rackId), rack.rackId)
    }
  } else {
    mgmtSubnet(find('mgmt'), 'Partition', [
      ...central,
      ...devices.racks.flatMap((r) => rackDevices(r.rackId)),
    ])
  }

  // PXE: one slice for the exits, one per leaf.
  const pxe = result.pxe
  const leaves = role('leaf')
  const exits = role('exit')
  if (pxe && leaves.length + exits.length > 0) {
    const slices = pxeSliceCount(leaves.length)
    const slicePrefix = pxe.prefix + Math.log2(slices)
    if (slicePrefix > 30) {
      notes.push(
        `${name}: ${formatCidr(pxe)} cannot be split into ${slices} PXE networks (one per leaf plus the exits); raise the headroom in the IPs tab.`,
      )
    } else {
      const exitSlice = subnet(pxe, slicePrefix, 0n)
      exits.forEach((d, i) => {
        const addr = exitSlice.addr + 1n + BigInt(i)
        if (addr < lastAddr(exitSlice)) set(d, { pxe: `${formatIp(4, addr)}/${slicePrefix}` })
      })
      const hosts = size(exitSlice) - 3n
      const reported = new Set<string>()
      leaves.forEach((d, i) => {
        const slice = subnet(pxe, slicePrefix, BigInt(i + 1))
        set(d, { pxe: `${formatIp(4, slice.addr + 1n)}/${slicePrefix}` })
        const rack = partition.racks.find((r) => r.id === d.rack?.rackId)
        const nodes = rack ? rackNodes(rack).total : 0
        if (rack && BigInt(nodes) > hosts && !reported.has(rack.id)) {
          reported.add(rack.id)
          notes.push(
            `${name}: the PXE network per leaf (/${slicePrefix}, ${hosts} hosts) is too small for the ${nodes} nodes of ${rack.name}; raise the headroom in the IPs tab.`,
          )
        }
      })
    }
  } else if (!pxe && leaves.length > 0) {
    notes.push(`${name}: the PXE subnet is not placed, metal-core CIDRs are left open.`)
  }

  // Transfer networks.
  const transfer = find('transfer')
  const prefix = plan.ipPlan.infra.transferPrefix
  const routers = role('router')
  if (transfer && prefix <= 31) {
    routers.forEach((router, r) =>
      exits.forEach((exit, e) => {
        for (let l = 0; l < 2; l++) {
          const cidr = subnet(transfer, prefix, BigInt((r * exits.length + e) * 2 + l))
          const exitAddr = prefix === 31 ? cidr.addr : cidr.addr + 1n
          result.transfers.push({
            exit: exit.hostname,
            router: router.hostname,
            link: l + 1,
            cidr,
            exitIp: formatIp(4, exitAddr),
            routerIp: formatIp(4, exitAddr + 1n),
          })
        }
      }),
    )
  }
  return result
}

export function deriveDeviceAddresses(
  plan: Plan,
  ip: IpPlanResult,
  devices: PartitionDevices[],
): PartitionAddresses[] {
  return devices.map((d) =>
    partitionAddresses(
      plan,
      d,
      ip.infra.partitions.find((p) => p.partitionId === d.partitionId),
    ),
  )
}
