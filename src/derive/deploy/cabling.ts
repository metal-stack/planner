import { catalog, sonicPortNames, type PortSpeed } from '../../model/catalog'
import { mgmtDeviceCount, type Partition, type Plan, type UplinkSpeed } from '../../model/plan'
import { chassisCount, mgmtUplinkSpeed } from '../bom'
import { hasOwnRack, inCentralRack } from '../controlPlane'

// The physical cable plan of a partition: every cable with both ends named
// (host and port), the hostnames of the devices, and the ports each switch
// uses for what. It follows the cabling model of derive/bom.ts cable for
// cable, and bom-cabling.test.ts holds the two derivations against each
// other. The port assignment is a convention of this planner, modelled on
// a production partition and the deployment guide's routed out-of-band
// network:
//
// - Leaf: spine uplinks on the top ports (Ethernet120/124 on a 32-port
//   leaf), servers from Ethernet0 upwards. Node n's NIC port p goes to leaf
//   (2n + p) mod leafCount; 25G server ports use 4x25G breakouts, a fresh
//   cage per server group and leaf, 100G server ports one port each.
// - Spine: leaves in rack order from Ethernet0 (leafSpineLinks each), then
//   exits, then storage leaves. Exits and storage leaves take their spine
//   uplinks from their top ports; exits take router links from Ethernet0,
//   then on-prem control plane nodes in the central rack, which attach to
//   the exits the way servers attach to their leaves.
// - Every switch's eth0: leaves to their rack's mgmt leaf; central-rack
//   switches and routers round-robin to the mgmt spines, from Ethernet0.
// - Mgmt spine i: mgmt server i on its last copper port (the guide's swp48),
//   mgmt leaf uplinks on its 25G (or 10G) ports, and its own eth0 on mgmt
//   firewall i.
// - Mgmt leaf: chassis BMCs from Ethernet0 upwards, leaf eth0s from its last
//   copper port downwards, uplinks to the mgmt spines on its 25G ports.
// - Mgmt firewall i (guide port names): eth6 to mgmt server i's eno1, eth5
//   to its ipmi, eth4 to mgmt spine i's eth0; eth7 is the uplink and is not
//   cabled here. Mgmt server i's eno3 goes to mgmt spine i.

export type CableKind = 'mtp-trunk' | 'mtp-breakout' | 'lc-duplex' | 'rj45'

export interface CableEnd {
  host: string
  port: string
}

export interface Cable {
  a: CableEnd
  b: CableEnd
  kind: CableKind
  /** A breakout's 25G lanes: which server port sits on which sub-port. */
  lanes?: { server: CableEnd; switchPort: string }[]
}

export type SwitchRole = 'spine' | 'exit' | 'storage-leaf' | 'leaf' | 'mgmt-spine' | 'mgmt-leaf'

export interface SwitchHost {
  name: string
  role: SwitchRole
  modelId: string
  /** Plan rack a leaf or mgmt leaf belongs to (a rack group once). */
  rackId?: string
  /** Fabric-facing ports that run BGP: towards the spines, or from a spine
   *  towards everything below it; mgmt switches towards each other. */
  bgpPorts: string[]
  /** Breakout mode per port, for leaves with 25G servers. */
  breakouts: Record<string, '4x25G'>
  /** Mgmt spine or mgmt leaf this switch's eth0 is cabled to. */
  mgmtAttachedTo?: string
}

export interface PartitionCabling {
  partitionId: string
  /** Hostname prefix: the partition name as a hostname label. */
  prefix: string
  switches: SwitchHost[]
  mgmtServers: string[]
  mgmtFirewalls: string[]
  routers: string[]
  cables: Cable[]
  /** Why the plan cannot be cabled as a whole; empty when it can. */
  problems: string[]
}

const pad = (n: number) => String(n).padStart(2, '0')

/** A hostname label from free text: lowercase, a-z 0-9 and single dashes. */
export function hostLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Free ports of one switch, handed out from the bottom or the top. */
class PortPool {
  private readonly free: Map<PortSpeed, string[]>

  constructor(
    readonly host: string,
    modelId: string,
    private readonly problems: string[],
  ) {
    this.free = new Map(
      (['1G', '10G', '25G', '100G'] as PortSpeed[]).map((speed) => [
        speed,
        sonicPortNames(modelId, speed),
      ]),
    )
  }

  take(speed: PortSpeed, fromTop = false): string {
    const ports = this.free.get(speed) ?? []
    const port = fromTop ? ports.pop() : ports.shift()
    if (port) return port
    this.problems.push(`${this.host} has no free ${speed} port left.`)
    return `${speed}-overflow`
  }
}

function rackPrefix(prefix: string, rackIndex: number): string {
  return `${prefix}-r${pad(rackIndex + 1)}`
}

export function deriveCabling(plan: Plan, partition: Partition): PartitionCabling {
  const { fabric } = partition
  const { mgmt } = fabric
  const prefix = hostLabel(partition.name)
  const problems: string[] = []
  const cables: Cable[] = []
  const switches: SwitchHost[] = []
  const pools = new Map<string, PortPool>()

  if (!prefix) problems.push(`Partition "${partition.name}" gives no usable hostname prefix.`)
  if (fabric.fabricType === 'leaf-spine-superspine') {
    problems.push('Superspine fabrics are not cabled yet.')
  }
  if (mgmt.layer === 'l2') problems.push('An L2 management network is not cabled yet.')
  if (hasOwnRack(plan, partition)) {
    problems.push('A control plane rack of its own is not cabled yet.')
  }

  function addSwitch(name: string, role: SwitchRole, modelId: string, rackId?: string): SwitchHost {
    if (!catalog[modelId]?.sonicPorts && !problems.some((p) => p.includes(modelId))) {
      problems.push(
        `No SONiC port map for ${catalog[modelId]?.model ?? modelId} (${modelId}); its ports cannot be named.`,
      )
    }
    const host: SwitchHost = { name, role, modelId, rackId, bgpPorts: [], breakouts: {} }
    switches.push(host)
    pools.set(name, new PortPool(name, modelId, problems))
    return host
  }
  const pool = (host: SwitchHost) => pools.get(host.name)!
  const cable = (a: CableEnd, b: CableEnd, kind: CableKind): Cable => {
    const c: Cable = { a, b, kind }
    cables.push(c)
    return c
  }

  const spines = Array.from({ length: fabric.spineCount }, (_, i) =>
    addSwitch(`${prefix}-spine${pad(i + 1)}`, 'spine', fabric.spineModelId),
  )
  const exits = Array.from({ length: fabric.exitSwitchCount }, (_, i) =>
    addSwitch(`${prefix}-exit${pad(i + 1)}`, 'exit', fabric.exitModelId),
  )
  const storageLeaves = Array.from({ length: fabric.storageLeafCount }, (_, i) =>
    addSwitch(`${prefix}-storleaf${pad(i + 1)}`, 'storage-leaf', fabric.storageLeafModelId),
  )
  const routers = Array.from(
    { length: fabric.routerCount },
    (_, i) => `${prefix}-router${pad(i + 1)}`,
  )

  const mgmtCount = mgmtDeviceCount(mgmt)
  const mgmtSpines = Array.from({ length: mgmtCount }, (_, i) =>
    addSwitch(`${prefix}-mgmtspine${pad(i + 1)}`, 'mgmt-spine', mgmt.spineModelId),
  )
  const mgmtServers = Array.from(
    { length: mgmtCount },
    (_, i) => `${prefix}-mgmtserver${pad(i + 1)}`,
  )
  const mgmtFirewalls = Array.from({ length: mgmtCount }, (_, i) => `${prefix}-mgmtfw${pad(i + 1)}`)

  // Leaves per rack, with their mgmt leaves.
  const racks = partition.racks.map((rack, r) => {
    const rp = rackPrefix(prefix, r)
    const leaves = Array.from({ length: rack.leafCount }, (_, i) =>
      addSwitch(`${rp}leaf${pad(i + 1)}`, 'leaf', rack.leafModelId, rack.id),
    )
    const mgmtLeaves = Array.from({ length: mgmt.leafPerRack }, (_, i) =>
      addSwitch(`${rp}mgmtleaf${pad(i + 1)}`, 'mgmt-leaf', mgmt.leafModelId, rack.id),
    )
    return { rack, rp, leaves, mgmtLeaves }
  })

  // Leaf uplinks: the top ports of each leaf, spine by spine.
  const links = fabric.leafSpineLinks
  for (const { leaves } of racks) {
    for (const leaf of leaves) {
      const uplinks = Array.from({ length: spines.length * links }, () =>
        pool(leaf).take('100G', true),
      ).reverse()
      spines.forEach((spine, s) => {
        for (let l = 0; l < links; l++) {
          const leafPort = uplinks[s * links + l]
          const spinePort = pool(spine).take('100G')
          leaf.bgpPorts.push(leafPort)
          spine.bgpPorts.push(spinePort)
          cable(
            { host: leaf.name, port: leafPort },
            { host: spine.name, port: spinePort },
            'mtp-trunk',
          )
        }
      })
    }
  }
  // Exits and storage leaves: one link to every spine, from their top ports.
  for (const upper of [...exits, ...storageLeaves]) {
    const uplinks = spines.map(() => pool(upper).take('100G', true)).reverse()
    spines.forEach((spine, s) => {
      const spinePort = pool(spine).take('100G')
      upper.bgpPorts.push(uplinks[s])
      spine.bgpPorts.push(spinePort)
      cable(
        { host: upper.name, port: uplinks[s] },
        { host: spine.name, port: spinePort },
        'mtp-trunk',
      )
    })
  }
  // Routers: two links to every exit, from the exits' bottom ports.
  for (const router of routers) {
    exits.forEach((exit, e) => {
      for (let l = 0; l < 2; l++) {
        const nic = `nic${e * 2 + l + 1}`
        cable(
          { host: router, port: nic },
          { host: exit.name, port: pool(exit).take('100G') },
          'mtp-trunk',
        )
      }
    })
  }

  // On-prem control plane nodes in the central rack, on the exits.
  const cp = plan.controlPlane
  const cpNodes = inCentralRack(plan, partition)
    ? Array.from({ length: cp.nodeCount }, (_, n) => `${prefix}-cp-node${pad(n + 1)}`)
    : []
  if (cpNodes.length > 0) {
    if (exits.length === 0) problems.push('Control plane nodes need exit switches to attach to.')
    else cableNodes(cpNodes, cp.uplink, exits)
  }

  // Servers on their rack's leaves.
  for (const { rack, rp, leaves } of racks) {
    if (leaves.length === 0) {
      if (rack.servers.some((g) => g.count > 0)) {
        problems.push(`${rack.name} has servers but no leaves.`)
      }
      continue
    }
    rack.servers.forEach((group, g) => {
      const nodes = Array.from(
        { length: group.count },
        (_, n) => `${rp}-g${g + 1}-node${pad(n + 1)}`,
      )
      cableNodes(nodes, group.uplink, leaves)
    })
  }

  /** Dual-attached nodes: node n's port p on switch (2n + p) mod count, 25G
   *  ports on 4x25G breakouts, a fresh cage per call and switch. */
  function cableNodes(nodes: string[], uplink: UplinkSpeed, switches: SwitchHost[]) {
    const breakoutCage = new Map<string, { base: number; cable: Cable }>()
    nodes.forEach((node, n) => {
      for (let p = 0; p < 2; p++) {
        const sw = switches[(2 * n + p) % switches.length]
        const nodePort = `nic${p + 1}`
        if (uplink === '2x100G') {
          cable(
            { host: node, port: nodePort },
            { host: sw.name, port: pool(sw).take('100G') },
            'mtp-trunk',
          )
          continue
        }
        let cage = breakoutCage.get(sw.name)
        if (!cage || cage.cable.lanes!.length === 4) {
          const port = pool(sw).take('100G')
          const c = cable({ host: node, port: nodePort }, { host: sw.name, port }, 'mtp-breakout')
          c.lanes = []
          cage = { base: Number(port.replace('Ethernet', '')), cable: c }
          breakoutCage.set(sw.name, cage)
          sw.breakouts[port] = '4x25G'
        }
        const lanes = cage.cable.lanes!
        lanes.push({
          server: { host: node, port: nodePort },
          switchPort: `Ethernet${cage.base + lanes.length}`,
        })
      }
    })
  }

  // Management: each switch's eth0.
  const centralMgmt = [...spines, ...exits, ...storageLeaves]
  centralMgmt.forEach((sw, i) => {
    const mgmtSpine = mgmtSpines[i % mgmtSpines.length]
    if (!mgmtSpine) return
    sw.mgmtAttachedTo = mgmtSpine.name
    cable(
      { host: sw.name, port: 'eth0' },
      { host: mgmtSpine.name, port: pool(mgmtSpine).take('1G') },
      'rj45',
    )
  })
  ;[...routers, ...cpNodes].forEach((device, i) => {
    const mgmtSpine = mgmtSpines[(centralMgmt.length + i) % mgmtSpines.length]
    if (!mgmtSpine) return
    cable(
      { host: device, port: routers.includes(device) ? 'bmc' : 'mgmt' },
      { host: mgmtSpine.name, port: pool(mgmtSpine).take('1G') },
      'rj45',
    )
  })

  // Each side of the management network: firewall, mgmt server, mgmt spine.
  mgmtSpines.forEach((mgmtSpine, i) => {
    const server = mgmtServers[i]
    const firewall = mgmtFirewalls[i]
    mgmtSpine.mgmtAttachedTo = firewall
    cable({ host: firewall, port: 'eth6' }, { host: server, port: 'eno1' }, 'rj45')
    cable({ host: firewall, port: 'eth5' }, { host: server, port: 'ipmi' }, 'rj45')
    cable({ host: firewall, port: 'eth4' }, { host: mgmtSpine.name, port: 'eth0' }, 'rj45')
    const serverPort = pool(mgmtSpine).take('1G', true)
    mgmtSpine.bgpPorts.push(serverPort)
    cable({ host: server, port: 'eno3' }, { host: mgmtSpine.name, port: serverPort }, 'rj45')
  })

  // Per rack: BMCs and leaf eth0s on the mgmt leaf, mgmt leaf uplinks.
  const uplinkSpeed = mgmtUplinkSpeed(mgmt.leafModelId, mgmt.spineModelId)
  for (const { rack, rp, leaves, mgmtLeaves } of racks) {
    const mgmtLeaf = mgmtLeaves[0]
    if (mgmtLeaf) {
      rack.servers.forEach((group, g) => {
        for (let c = 0; c < chassisCount(group); c++) {
          cable(
            { host: `${rp}-g${g + 1}-chassis${pad(c + 1)}`, port: 'bmc' },
            { host: mgmtLeaf.name, port: pool(mgmtLeaf).take('1G') },
            'rj45',
          )
        }
      })
      for (const leaf of leaves) {
        leaf.mgmtAttachedTo = mgmtLeaf.name
        cable(
          { host: leaf.name, port: 'eth0' },
          { host: mgmtLeaf.name, port: pool(mgmtLeaf).take('1G', true) },
          'rj45',
        )
      }
    } else if (leaves.length > 0) {
      problems.push(`${rack.name} has no mgmt leaf for its BMCs and leaf mgmt ports.`)
    }
    for (const ml of mgmtLeaves) {
      for (const mgmtSpine of mgmtSpines) {
        const leafPort = pool(ml).take(uplinkSpeed)
        const spinePort = pool(mgmtSpine).take(uplinkSpeed)
        ml.bgpPorts.push(leafPort)
        mgmtSpine.bgpPorts.push(spinePort)
        cable(
          { host: ml.name, port: leafPort },
          { host: mgmtSpine.name, port: spinePort },
          'lc-duplex',
        )
      }
    }
  }

  return {
    partitionId: partition.id,
    prefix,
    switches,
    mgmtServers,
    mgmtFirewalls,
    routers,
    cables,
    problems: [...new Set(problems)],
  }
}

/** Hostname collisions across partitions, after turning names into labels. */
export function hostnameProblems(plan: Plan): string[] {
  const seen = new Map<string, string>()
  const out: string[] = []
  for (const p of plan.partitions) {
    const label = hostLabel(p.name)
    const other = seen.get(label)
    if (other !== undefined) {
      out.push(`Partitions "${other}" and "${p.name}" give the same hostname prefix "${label}".`)
    }
    seen.set(label, p.name)
  }
  return out
}
