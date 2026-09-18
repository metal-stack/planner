import { mgmtDeviceCount, type Partition, type Plan } from '../model/plan'

// Every named device of the plan: the single source of hostnames and ASNs
// for the Ansible export. Counts come from the same plan fields the BOM
// and the topology read; like them, this is derived, never stored.
//
// Hostnames follow the deployment repositories metal-stack operators keep
// (`<partition>-spine01`, `<partition>-r01leaf01`, `<partition>-r01mgmtleaf`
// …): the partition slug, then the device, with racks numbered in plan
// order (a rack group once, its leaves sit in the middle rack). Rack names
// are display only; identifiers are always the slug and the rack number,
// unique within the plan.
//
// ASNs follow the numbering model of the metal-stack network docs
// (docs.metal-stack.io, Concepts › Network › Theory, "ASN Numbering"):
// private 4-byte ASNs (RFC 6996), leaves unique, spines share one, exits
// share one. The same holds per tier here: superspines and mgmt spines
// share one, storage leaves, mgmt leaves and mgmt servers are unique. Each
// partition gets a block of 100000 above `Plan.deployment.asnBase`:
//
//   leaves        base + p·100000 +     1 + i
//   storage leaves               +  5001 + i
//   superspines                  + 10000
//   spines                       + 20000
//   exits                        + 30000
//   mgmt spines                  + 40000
//   mgmt leaves                  + 41001 + i
//   mgmt servers                 + 45001 + i
//
// Internet routers get no ASN: they peer with the provider, and no
// metal-roles role configures them.

export type DeviceRole =
  | 'router'
  | 'superspine'
  | 'spine'
  | 'exit'
  | 'storage-leaf'
  | 'mgmt-spine'
  | 'mgmt-server'
  | 'mgmt-leaf'
  | 'leaf'

export interface Device {
  hostname: string
  role: DeviceRole
  modelId: string
  /** 1-based within its role (and rack, for rack devices). */
  index: number
  asn: number | null
  /** Set on leaves and mgmt leaves. */
  rack?: DeviceRack
}

export interface DeviceRack {
  rackId: string
  /** Plan rack name (a rack group's name). */
  name: string
  /** 1-based position in the partition's rack list. */
  number: number
  /** "r01" */
  tag: string
  /** metal-stack's rack id (metal_core_rack_id), "partition-1-rack01". */
  metalId: string
}

export interface PartitionDevices {
  partitionId: string
  partitionName: string
  /** Hostname prefix and metal-stack partition id, e.g. "partition-1". */
  slug: string
  /** Ansible group name prefix (slug with underscores). */
  group: string
  racks: DeviceRack[]
  devices: Device[]
}

const PARTITION_STRIDE = 100000
const ASN_OFFSET = {
  leaf: 1,
  'storage-leaf': 5001,
  superspine: 10000,
  spine: 20000,
  exit: 30000,
  'mgmt-spine': 40000,
  'mgmt-leaf': 41001,
  'mgmt-server': 45001,
} as const
/** Roles whose devices share one ASN per partition. */
const SHARED_ASN = new Set<DeviceRole>(['superspine', 'spine', 'exit', 'mgmt-spine'])

const pad = (n: number) => String(n).padStart(2, '0')

/** Lowercase DNS label from a display name ("Partition 1" → "partition-1"). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Ansible group names take letters, digits and underscores only. */
export function groupName(slug: string): string {
  const g = slug.replace(/-/g, '_')
  return /^[a-z_]/.test(g) ? g : `p_${g}`
}

/** Identifiers of the n-th rack (1-based) of a partition: the hostname
 *  tag and metal-stack's rack id. */
function rackIds(slug: string, n: number): { tag: string; metalId: string } {
  return { tag: `r${pad(n)}`, metalId: `${slug}-rack${pad(n)}` }
}

function uniqueSlugs(partitions: Partition[]): string[] {
  const used = new Set<string>()
  return partitions.map((p, i) => {
    const base = slugify(p.name) || `partition-${i + 1}`
    let slug = base
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`
    used.add(slug)
    return slug
  })
}

function partitionDevices(
  partition: Partition,
  partitionIndex: number,
  slug: string,
  asnBase: number,
): PartitionDevices {
  const { fabric } = partition
  const { mgmt } = fabric
  const base = asnBase + partitionIndex * PARTITION_STRIDE
  const devices: Device[] = []
  const counters = new Map<DeviceRole, number>()

  const asnFor = (role: DeviceRole, ordinal: number): number | null => {
    if (role === 'router') return null
    const offset = ASN_OFFSET[role]
    return SHARED_ASN.has(role) ? base + offset : base + offset + ordinal
  }
  const add = (
    role: DeviceRole,
    modelId: string,
    name: string,
    index: number,
    rack?: DeviceRack,
  ) => {
    // Unique ASNs count across the partition (leaves of all racks).
    const ordinal = counters.get(role) ?? 0
    counters.set(role, ordinal + 1)
    devices.push({
      hostname: `${slug}-${name}`,
      role,
      modelId,
      index,
      asn: asnFor(role, ordinal),
      rack,
    })
  }
  const tier = (role: DeviceRole, name: string, modelId: string, count: number) => {
    for (let i = 1; i <= count; i++) add(role, modelId, `${name}${pad(i)}`, i)
  }

  tier('router', 'inet', 'router-internet', fabric.routerCount)
  if (fabric.fabricType === 'leaf-spine-superspine') {
    tier('superspine', 'superspine', fabric.superspineModelId, fabric.superspineCount)
  }
  tier('spine', 'spine', fabric.spineModelId, fabric.spineCount)
  tier('exit', 'exit', fabric.exitModelId, fabric.exitSwitchCount)
  tier('storage-leaf', 'storageleaf', fabric.storageLeafModelId, fabric.storageLeafCount)
  tier('mgmt-spine', 'mgmtspine', mgmt.spineModelId, mgmtDeviceCount(mgmt))
  tier('mgmt-server', 'mgmtserver', mgmt.serverModelId, mgmtDeviceCount(mgmt))

  const racks = partition.racks.map((rack, i): DeviceRack => ({
    rackId: rack.id,
    name: rack.name,
    number: i + 1,
    ...rackIds(slug, i + 1),
  }))
  partition.racks.forEach((rack, i) => {
    const r = racks[i]
    for (let m = 1; m <= mgmt.leafPerRack; m++) {
      add(
        'mgmt-leaf',
        mgmt.leafModelId,
        `${r.tag}mgmtleaf${mgmt.leafPerRack > 1 ? pad(m) : ''}`,
        m,
        r,
      )
    }
    for (let l = 1; l <= rack.leafCount; l++) {
      add('leaf', rack.leafModelId, `${r.tag}leaf${pad(l)}`, l, r)
    }
  })

  return {
    partitionId: partition.id,
    partitionName: partition.name,
    slug,
    group: groupName(slug),
    racks,
    devices,
  }
}

export function deriveDevices(plan: Plan): PartitionDevices[] {
  const slugs = uniqueSlugs(plan.partitions)
  return plan.partitions.map((p, i) => partitionDevices(p, i, slugs[i], plan.deployment.asnBase))
}

export const devicesOf = (p: PartitionDevices, role: DeviceRole): Device[] =>
  p.devices.filter((d) => d.role === role)
