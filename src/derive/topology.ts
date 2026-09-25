import { catalog } from '../model/catalog'
import { controlPlaneHost } from './controlPlane'
import { physicalRacks, type RackPosition } from './rackLayout'
import {
  mgmtDeviceCount,
  type ExternalNetwork,
  type Partition,
  type Plan,
  type Rack,
} from '../model/plan'

// Derives the topology graph rendered by TopologyView. Like the BOM, the
// graph is always computed from the Plan, never stored. The graph is
// structured (partitions -> central rack / compute racks -> nodes) rather
// than flat so the renderer can draw racks as physical units without
// re-reading the Plan.

export type TopoNodeKind =
  | 'router'
  | 'superspine'
  | 'spine'
  | 'exit'
  | 'leaf'
  | 'storage-leaf'
  | 'mgmt-spine'
  | 'mgmt-leaf'
  | 'mgmt-server'
  | 'server-group'
  | 'control-plane'
  | 'external-network'

export interface TopoNode {
  id: string
  kind: TopoNodeKind
  label: string
  sublabel?: string
  /** For external networks: what kind of network it is. */
  networkKind?: ExternalNetwork['kind']
}

export type LinkNetwork = 'production' | 'management' | 'external'

export interface TopoLink {
  from: string
  to: string
  count: number
  speed?: '1G' | '10G' | '25G' | '100G'
  network: LinkNetwork
}

/** One physical rack. A rack group yields three of these that
 *  share `entity`; only the middle one holds the leaves and mgmt leaf, and
 *  the left/right racks' server groups uplink to those. */
export interface TopoRack {
  id: string
  name: string
  /** Set for the physical racks of a rack group. */
  entity?: { id: string; name: string; position: RackPosition }
  leaves: TopoNode[]
  mgmtLeaves: TopoNode[]
  serverGroups: TopoNode[]
}

/** Spines, exits, superspines, mgmt spines and mgmt servers all live in the
 *  partition's central rack. */
export interface TopoCentralRack {
  /** Internet routers; external networks attach here when present. */
  routers: TopoNode[]
  superspines: TopoNode[]
  spines: TopoNode[]
  exits: TopoNode[]
  mgmtSpines: TopoNode[]
  mgmtServers: TopoNode[]
}

export interface TopoPartition {
  id: string
  name: string
  central: TopoCentralRack
  storageLeaves: TopoNode[]
  racks: TopoRack[]
  /** The control plane, when this partition carries it: a KaaS cluster
   *  (`managed`, drawn as a capsule like an external network) or on-prem
   *  nodes in the central rack. On-prem nodes in a rack of their own are a
   *  TopoRack in `racks` instead, so they lay out like any other rack. */
  controlPlane?: TopoControlPlane
  /** External networks attached at this partition's exits. A network that
   *  attaches to every partition appears once per partition, so each is
   *  drawn next to the exits it connects to. */
  externalNetworks: TopoNode[]
}

/** The control plane as the diagram needs it: the node plus whether it is
 *  a managed cluster somewhere else (capsule) or hardware in this rack. */
export interface TopoControlPlane {
  node: TopoNode
  managed: boolean
}

export interface TopologyGraph {
  partitions: TopoPartition[]
  links: TopoLink[]
}

function part(modelId: string): string {
  return catalog[modelId]?.partNumber ?? modelId
}

function tier(
  idPrefix: string,
  kind: TopoNodeKind,
  labelPrefix: string,
  modelId: string,
  count: number,
  sublabelSuffix = '',
): TopoNode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${idPrefix}${i}`,
    kind,
    label: count > 1 ? `${labelPrefix} ${i + 1}` : labelPrefix,
    sublabel: part(modelId) + sublabelSuffix,
  }))
}

function deriveRack(partition: Partition, rack: Rack, links: TopoLink[]): TopoRack[] {
  const p = `${partition.id}/${rack.id}/`
  const leaves = tier(`${p}leaf`, 'leaf', 'Leaf', rack.leafModelId, rack.leafCount)
  // The mgmt leaf also carries the rack's out-of-band/BMC access.
  const mgmtLeaves = tier(
    `${p}mgmtleaf`,
    'mgmt-leaf',
    'Mgmt leaf',
    partition.fabric.mgmt.leafModelId,
    partition.fabric.mgmt.leafPerRack,
  )

  // Production leaves cross-connect into the management fabric.
  for (const leaf of leaves) {
    for (const mgmtLeaf of mgmtLeaves) {
      links.push({ from: leaf.id, to: mgmtLeaf.id, count: 1, speed: '1G', network: 'management' })
    }
  }

  const physical = physicalRacks(rack, partition.fabric)
  return physical.map((phys): TopoRack => {
    // Nodes of each group that landed in this physical rack (chassis-level
    // spread for rack groups; everything for a single rack).
    const nodesByGroup = new Map<string, number>()
    for (const chassis of phys.chassis) {
      if (chassis.groupId === undefined) continue
      nodesByGroup.set(
        chassis.groupId,
        (nodesByGroup.get(chassis.groupId) ?? 0) + (chassis.nodes ?? 0),
      )
    }
    const idPrefix = phys.position ? `${p}${phys.position}/` : p

    const serverGroups: TopoNode[] = []
    for (const group of rack.servers) {
      const count = nodesByGroup.get(group.id) ?? 0
      // Keep an empty group visible in a single rack so the user sees it;
      // skip it in rack-group positions it didn't spread into.
      if (count === 0 && phys.position) continue
      const nodeId = `${idPrefix}${group.id}`
      serverGroups.push({
        id: nodeId,
        kind: 'server-group',
        label: `${count} × ${group.role}`,
        sublabel: `${part(group.modelId)}, ${group.uplink}`,
      })
      // Server groups have no edges on purpose: their uplinks to the leaves
      // and their BMC links to the mgmt leaf are one edge per group and
      // switch and clutter the picture. The uplink speed is in the group's
      // sublabel, and the BOM still counts every port and cable.
    }

    const isMid = !phys.position || phys.position === 'mid'
    return {
      id: phys.position ? `${rack.id}/${phys.position}` : rack.id,
      name: phys.name,
      entity: phys.position ? { id: rack.id, name: rack.name, position: phys.position } : undefined,
      leaves: isMid ? leaves : [],
      mgmtLeaves: isMid ? mgmtLeaves : [],
      serverGroups,
    }
  })
}

function derivePartition(partition: Partition, links: TopoLink[]): TopoPartition {
  const p = `${partition.id}/`
  const { fabric } = partition
  const { mgmt } = fabric

  const hasSuperspine = fabric.fabricType === 'leaf-spine-superspine'
  const mgmtCount = mgmtDeviceCount(mgmt)
  const mgmtSuffix = `, ${mgmt.layer.toUpperCase()}`

  const central: TopoCentralRack = {
    routers: tier(`${p}router`, 'router', 'Router', 'router-internet', fabric.routerCount),
    superspines: hasSuperspine
      ? tier(
          `${p}superspine`,
          'superspine',
          'Superspine',
          fabric.superspineModelId,
          fabric.superspineCount,
        )
      : [],
    spines: tier(`${p}spine`, 'spine', 'Spine', fabric.spineModelId, fabric.spineCount),
    exits: tier(`${p}exit`, 'exit', 'Exit', fabric.exitModelId, fabric.exitSwitchCount),
    mgmtSpines: tier(
      `${p}mgmtspine`,
      'mgmt-spine',
      'Mgmt spine',
      mgmt.spineModelId,
      mgmtCount,
      mgmtSuffix,
    ),
    mgmtServers: tier(
      `${p}mgmtserver`,
      'mgmt-server',
      'Mgmt server',
      mgmt.serverModelId,
      mgmtCount,
    ),
  }

  const storageLeaves = tier(
    `${p}storageleaf`,
    'storage-leaf',
    'Storage leaf',
    fabric.storageLeafModelId,
    fabric.storageLeafCount,
  )

  // Each router is linked twice (2x dual-port 100G) to every exit.
  for (const router of central.routers) {
    for (const exit of central.exits) {
      links.push({ from: router.id, to: exit.id, count: 2, speed: '100G', network: 'production' })
    }
  }

  for (const spine of central.spines) {
    for (const superspine of central.superspines) {
      links.push({
        from: spine.id,
        to: superspine.id,
        count: 1,
        speed: '100G',
        network: 'production',
      })
    }
    for (const exit of central.exits) {
      links.push({ from: exit.id, to: spine.id, count: 1, speed: '100G', network: 'production' })
    }
    for (const storageLeaf of storageLeaves) {
      links.push({
        from: storageLeaf.id,
        to: spine.id,
        count: 1,
        speed: '100G',
        network: 'production',
      })
    }
    for (const mgmtSpine of central.mgmtSpines) {
      links.push({ from: spine.id, to: mgmtSpine.id, count: 1, speed: '1G', network: 'management' })
    }
  }
  for (const mgmtServer of central.mgmtServers) {
    for (const mgmtSpine of central.mgmtSpines) {
      links.push({
        from: mgmtServer.id,
        to: mgmtSpine.id,
        count: 1,
        speed: '1G',
        network: 'management',
      })
    }
  }

  const racks = partition.racks.flatMap((rack) => deriveRack(partition, rack, links))

  for (const rack of racks) {
    for (const leaf of rack.leaves) {
      for (const spine of central.spines) {
        links.push({
          from: leaf.id,
          to: spine.id,
          count: fabric.leafSpineLinks,
          speed: '100G',
          network: 'production',
        })
      }
    }
    for (const mgmtLeaf of rack.mgmtLeaves) {
      for (const mgmtSpine of central.mgmtSpines) {
        links.push({
          from: mgmtLeaf.id,
          to: mgmtSpine.id,
          count: 1,
          speed: '1G',
          network: 'management',
        })
      }
    }
  }

  return {
    id: partition.id,
    name: partition.name,
    central,
    storageLeaves,
    racks,
    externalNetworks: [],
  }
}

/** The control plane's place in the graph. KaaS hangs off the routers of
 *  every partition (or their exits), the same way an external network
 *  does, because that is the connection the partitions need to it. On-prem
 *  nodes are hardware: in the central rack they attach to the exits, in a
 *  rack of their own they sit behind that rack's leaves. */
function addControlPlane(plan: Plan, partitions: TopoPartition[], links: TopoLink[]): void {
  const cp = plan.controlPlane
  const label = 'Control plane'

  if (cp.hosting === 'kaas') {
    for (const partition of partitions) {
      // Titled by what it is, like every other node; the cluster's name is
      // the subtitle, where the on-prem node box carries its hardware.
      const node: TopoNode = {
        id: `cp/${partition.id}`,
        kind: 'control-plane',
        label,
        sublabel: cp.name,
      }
      partition.controlPlane = { node, managed: true }
      const attach =
        partition.central.routers.length > 0 ? partition.central.routers : partition.central.exits
      for (const device of attach) {
        links.push({ from: node.id, to: device.id, count: 1, network: 'external' })
      }
    }
    return
  }

  const hostId = controlPlaneHost(plan)?.id
  const host = partitions.find((p) => p.id === hostId)
  if (!host || cp.nodeCount === 0) return
  // Kept short: the node box is as narrow as a switch box.
  const sublabel = `${cp.nodeCount} × ${part(cp.nodeModelId)}`

  if (cp.placement === 'central-rack') {
    const node: TopoNode = { id: `cp/${host.id}`, kind: 'control-plane', label, sublabel }
    host.controlPlane = { node, managed: false }
    for (const exit of host.central.exits) {
      links.push({
        from: node.id,
        to: exit.id,
        count: 2 * cp.nodeCount,
        speed: cp.uplink === '2x100G' ? '100G' : '25G',
        network: 'production',
      })
    }
    return
  }

  // A rack of its own: leaves to every spine, mgmt leaf to every mgmt
  // spine, and the nodes drawn as one box inside the rack.
  const partition = controlPlaneHost(plan)!
  const { mgmt } = partition.fabric
  const prefix = `cp/${host.id}/`
  const leaves = tier(`${prefix}leaf`, 'leaf', 'Leaf', cp.rack.leafModelId, cp.rack.leafCount)
  const mgmtLeaves = tier(
    `${prefix}mgmtleaf`,
    'mgmt-leaf',
    'Mgmt leaf',
    mgmt.leafModelId,
    mgmt.leafPerRack,
  )
  for (const leaf of leaves) {
    for (const spine of host.central.spines) {
      links.push({
        from: leaf.id,
        to: spine.id,
        count: partition.fabric.leafSpineLinks,
        speed: '100G',
        network: 'production',
      })
    }
  }
  for (const mgmtLeaf of mgmtLeaves) {
    for (const mgmtSpine of host.central.mgmtSpines) {
      links.push({
        from: mgmtLeaf.id,
        to: mgmtSpine.id,
        count: 1,
        speed: '1G',
        network: 'management',
      })
    }
  }
  host.racks.push({
    id: CONTROL_PLANE_RACK_ID,
    name: cp.rack.name,
    leaves,
    mgmtLeaves,
    serverGroups: [{ id: `${prefix}nodes`, kind: 'control-plane', label, sublabel }],
  })
}

/** Rack id of the separate control-plane rack in the graph; navigation
 *  maps it to the control plane section instead of a plan rack. */
export const CONTROL_PLANE_RACK_ID = 'control-plane'

export function deriveTopology(plan: Plan): TopologyGraph {
  const links: TopoLink[] = []
  const partitions = plan.partitions.map((partition) => derivePartition(partition, links))
  addControlPlane(plan, partitions, links)

  // External networks attach at the exit switches of their partition (or
  // every partition when unset), as one node per partition they attach to.
  for (const net of plan.externalNetworks) {
    const targets = partitions.filter(
      (p) => !net.attachedPartitionId || p.id === net.attachedPartitionId,
    )
    for (const partition of targets) {
      const node: TopoNode = {
        id: `ext/${net.id}/${partition.id}`,
        kind: 'external-network',
        label: net.name,
        sublabel: net.kind,
        networkKind: net.kind,
      }
      partition.externalNetworks.push(node)
      // Attach at the routers, or directly at the exits when there are none.
      const attach =
        partition.central.routers.length > 0 ? partition.central.routers : partition.central.exits
      for (const device of attach) {
        links.push({ from: node.id, to: device.id, count: 1, network: 'external' })
      }
    }
  }

  return { partitions, links }
}

/** What the topology view shows: the production network (default), the
 *  management network, or the central rack alone with both networks. */
export type TopologyMode = 'production' | 'management' | 'central'

const MGMT_KINDS = new Set<TopoNodeKind>(['mgmt-spine', 'mgmt-leaf', 'mgmt-server'])

function nodeVisible(node: TopoNode, mode: TopologyMode): boolean {
  if (mode === 'central') return true
  const isMgmt = MGMT_KINDS.has(node.kind)
  if (mode === 'management') return isMgmt || node.kind === 'server-group'
  return !isMgmt
}

/** The subgraph for a view mode: nodes of the other network are dropped,
 *  compute racks and storage are dropped in central mode, external
 *  networks and the control plane in management mode, and links are kept
 *  only when both ends remain and belong to the shown network. */
export function filterTopology(graph: TopologyGraph, mode: TopologyMode): TopologyGraph {
  const keep = (nodes: TopoNode[]) => nodes.filter((n) => nodeVisible(n, mode))
  const partitions = graph.partitions.map((p): TopoPartition => ({
    ...p,
    central: {
      routers: keep(p.central.routers),
      superspines: keep(p.central.superspines),
      spines: keep(p.central.spines),
      exits: keep(p.central.exits),
      mgmtSpines: keep(p.central.mgmtSpines),
      mgmtServers: keep(p.central.mgmtServers),
    },
    storageLeaves: mode === 'central' ? [] : keep(p.storageLeaves),
    racks:
      mode === 'central'
        ? []
        : p.racks.map((r) => ({
            ...r,
            leaves: keep(r.leaves),
            mgmtLeaves: keep(r.mgmtLeaves),
            serverGroups: keep(r.serverGroups),
          })),
    externalNetworks: mode === 'management' ? [] : p.externalNetworks,
    // The control plane is production or external, never management; in
    // central mode the capsule and the central-rack node both stay,
    // because what they attach to stays too.
    controlPlane: mode === 'management' ? undefined : p.controlPlane,
  }))
  const ids = new Set<string>()
  for (const p of partitions) {
    for (const n of [
      ...p.central.routers,
      ...p.central.superspines,
      ...p.central.spines,
      ...p.central.exits,
      ...p.central.mgmtSpines,
      ...p.central.mgmtServers,
      ...p.storageLeaves,
      ...p.externalNetworks,
      ...(p.controlPlane ? [p.controlPlane.node] : []),
      ...p.racks.flatMap((r) => [...r.leaves, ...r.mgmtLeaves, ...r.serverGroups]),
    ]) {
      ids.add(n.id)
    }
  }
  const links = graph.links.filter((l) => {
    if (!ids.has(l.from) || !ids.has(l.to)) return false
    if (mode === 'production') return l.network !== 'management'
    if (mode === 'management') return l.network === 'management'
    return true
  })
  return { partitions, links }
}
