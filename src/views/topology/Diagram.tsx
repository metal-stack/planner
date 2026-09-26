import { useRef, useState } from 'react'
import { EXTERNAL_NETWORK_ICON, NODE_ICON } from '../icons'
import { COLOR } from '../colors'
import {
  attachesAtStorageLeaves,
  type TopoLink,
  type TopoNode,
  type TopologyGraph,
  type TopoPartition,
  type TopoPod,
  type TopoRack,
} from '../../derive/topology'
import { nodeSelections, type Selection } from './build'

// Renders the derived TopologyGraph as a fabric elevation. Each partition
// draws its central rack as one physical unit with two columns: production
// gear on the left (exits/superspines above the spines) and management gear
// on the right (mgmt servers above the mgmt spines, each with its mgmt
// firewall on the outer side, so the chain firewall - server - mgmt spine
// of either side never crosses the other). Keeping both tiers
// that connect downwards — spines and mgmt spines — in the bottom row means
// the uplinks from the compute racks (ToR leaves to spines, mgmt leaf to
// mgmt spines) never have to cross another row of devices. Compute racks
// (mgmt leaf on top, ToR leaves, server groups) and the storage box sit
// below. Link color encodes the network (production / management /
// external), stroke width encodes speed, and an animated pulse (styles in
// index.css, disabled for prefers-reduced-motion) shows the direction of
// traffic flow. Bundled link counts are deliberately not labeled.

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const NODE_W = 118
const NODE_H = 44
const GAP = 10
const RACK_PAD = 10
const RACK_HEAD = 18
const SRV_H = 46
const MARGIN = 16
const ROW_GAP = 28
/** Size of the device glyph drawn in each node box. */
const GLYPH = 14
/** Gap between the production and management columns of the central rack. */
const COLUMN_GAP = 56
/** External network capsule size. */
const EXT_W = 132
const EXT_H = 34

const LINK_COLOR: Record<TopoLink['network'], string> = {
  production: COLOR.production,
  management: COLOR.mgmtData,
  external: COLOR.gray500,
}

/** Management links are colored by the port they land on: green between
 *  front-panel ports, red where one end is a switch's eth0. */
function linkColor(link: TopoLink): string {
  return link.mgmtPort ? COLOR.mgmtPort : LINK_COLOR[link.network]
}

const LINK_WIDTH: Record<NonNullable<TopoLink['speed']> | 'none', number> = {
  '100G': 2.2,
  '25G': 1.4,
  '10G': 1.2,
  '1G': 1,
  none: 1.4,
}

/** Seconds per animation loop — faster links pulse faster. */
const FLOW_DURATION: Record<NonNullable<TopoLink['speed']> | 'none', number> = {
  '100G': 2.2,
  '25G': 3,
  '10G': 3.4,
  '1G': 4.5,
  none: 3,
}

function rowWidth(n: number): number {
  return n > 0 ? n * NODE_W + (n - 1) * GAP : 0
}

/** What a click on a diagram element selects (see ./build). */
export type DiagramTarget = Selection

interface BoxLayout {
  rect: Rect
  name: string
  /** Enclosing box of a rack group (drawn dashed, behind its racks). */
  entity?: boolean
  /** Enclosing box of a pod: its spines over its racks. */
  pod?: boolean
  target?: DiagramTarget
}

interface Layout {
  width: number
  height: number
  rects: Map<string, Rect>
  boxes: BoxLayout[]
  partitionLabels: { x: number; y: number; name: string }[]
}

function placeRow(rects: Map<string, Rect>, nodes: TopoNode[], cx: number, y: number, h = NODE_H) {
  const w = rowWidth(nodes.length)
  let x = cx - w / 2
  for (const node of nodes) {
    rects.set(node.id, { x, y, w: NODE_W, h })
    x += NODE_W + GAP
  }
}

/** The mgmt servers with their firewalls on the outer side:
 *  [firewall 1, server 1, server 2, firewall 2]. Each server then sits over
 *  its own mgmt spine, and each firewall reaches both of its peers without
 *  crossing a link of the other side. */
function mgmtServerRow(central: TopoPartition['central']): TopoNode[] {
  return central.mgmtServers.flatMap((server, i) => {
    const firewall = central.mgmtFirewalls[i]
    if (!firewall) return [server]
    return i % 2 === 0 ? [firewall, server] : [server, firewall]
  })
}

/** A centered row of external network capsules. */
function placeCapsules(rects: Map<string, Rect>, nodes: TopoNode[], cx: number, y: number) {
  let x = cx - (nodes.length * (EXT_W + GAP) - GAP) / 2
  for (const node of nodes) {
    rects.set(node.id, { x, y, w: EXT_W, h: EXT_H })
    x += EXT_W + GAP
  }
}

/** Two node groups sharing one centered row with a gap between them. */
function placeGroupedRow(
  rects: Map<string, Rect>,
  left: TopoNode[],
  right: TopoNode[],
  cx: number,
  y: number,
): number {
  const lw = rowWidth(left.length)
  const rw = rowWidth(right.length)
  const gap = lw > 0 && rw > 0 ? 56 : 0
  const start = cx - (lw + gap + rw) / 2
  if (lw > 0) placeRow(rects, left, start + lw / 2, y)
  if (rw > 0) placeRow(rects, right, start + lw + gap + rw / 2, y)
  return lw + gap + rw
}

function rackInnerWidth(rack: TopoRack): number {
  return Math.max(246, rowWidth(rack.leaves.length), rowWidth(rack.mgmtLeaves.length))
}

function layoutRack(
  rects: Map<string, Rect>,
  rack: TopoRack,
  x: number,
  y: number,
  partitionId: string,
): BoxLayout {
  const innerW = rackInnerWidth(rack)
  const cx = x + RACK_PAD + innerW / 2
  let cy = y + RACK_HEAD
  // The mgmt leaf sits at the top of the rack, above the leaves — the same
  // order as the physical rack elevation.
  if (rack.mgmtLeaves.length > 0) {
    placeRow(rects, rack.mgmtLeaves, cx, cy)
    cy += NODE_H + 14
  }
  if (rack.leaves.length > 0) {
    placeRow(rects, rack.leaves, cx, cy)
    cy += NODE_H + 14
  }
  for (const group of rack.serverGroups) {
    rects.set(group.id, { x: x + RACK_PAD, y: cy, w: innerW, h: SRV_H })
    cy += SRV_H + 8
  }
  // An empty physical rack (a rack-group side nothing spread into) still
  // gets a small body so the group reads as three racks.
  if (cy === y + RACK_HEAD) cy += 22
  return {
    rect: { x, y, w: innerW + 2 * RACK_PAD, h: cy - y + RACK_PAD - 8 },
    name: rack.name,
    target: { partitionId, rackId: rack.entity?.id ?? rack.id },
  }
}

const RACK_GAP = 24
/** Gap between the physical racks of one rack group. */
const ENTITY_GAP = 10
/** Padding of the box drawn around a rack group, and the room its
 *  label needs above the physical racks' own headers. */
const ENTITY_PAD = 8
const ENTITY_HEAD = 26

/** Whether two adjacent racks belong to the same rack group. */
function sameEntity(a: TopoRack | undefined, b: TopoRack | undefined): boolean {
  return !!a?.entity && !!b?.entity && a.entity.id === b.entity.id
}

/** Total width of a partition's compute racks including gaps and entity padding. */
function racksRowWidth(racks: TopoRack[]): number {
  let w = 0
  racks.forEach((rack, i) => {
    if (rack.entity && !sameEntity(racks[i - 1], rack)) w += ENTITY_PAD
    w += rackInnerWidth(rack) + 2 * RACK_PAD
    if (rack.entity && !sameEntity(rack, racks[i + 1])) w += ENTITY_PAD
    if (i < racks.length - 1) w += sameEntity(rack, racks[i + 1]) ? ENTITY_GAP : RACK_GAP
  })
  return w
}

/** Padding of a pod box, and the band above its racks for its spines. */
const POD_PAD = 10
const POD_BAND = RACK_HEAD + NODE_H + 30

/** Racks grouped by pod, in pod order; one group without a pod for a
 *  leaf-spine partition (or in a view mode that shows no pods). */
function rackGroups(partition: TopoPartition): { pod?: TopoPod; racks: TopoRack[] }[] {
  const pods = partition.pods.filter((p) => p.spines.length > 0)
  if (pods.length === 0) return [{ racks: partition.racks }]
  return pods.map((pod) => ({ pod, racks: partition.racks.filter((r) => r.podId === pod.id) }))
}

function groupWidth(group: { pod?: TopoPod; racks: TopoRack[] }): number {
  const racks = racksRowWidth(group.racks)
  if (!group.pod) return racks
  return Math.max(racks, rowWidth(group.pod.spines.length)) + 2 * POD_PAD
}

function layoutPartition(
  layout: Layout,
  partition: TopoPartition,
  y0: number,
): { partW: number; partH: number } {
  const { rects } = layout
  const { central } = partition

  const groups = rackGroups(partition)
  const hasPods = groups.some((g) => g.pod)
  const racksW =
    groups.reduce((w, g) => w + groupWidth(g), 0) + Math.max(0, groups.length - 1) * RACK_GAP
  // Storage networks hang off the storage leaves when the partition has
  // them (attachesAtStorageLeaves), so they are drawn over the storage box
  // instead of over the central rack, keeping their links short.
  const storageNets = partition.externalNetworks.filter((n) =>
    attachesAtStorageLeaves(partition, n),
  )
  const centralNets = partition.externalNetworks.filter(
    (n) => !attachesAtStorageLeaves(partition, n),
  )
  const storageW =
    partition.storageLeaves.length > 0
      ? Math.max(NODE_W + 2 * RACK_PAD + 24, storageNets.length * (EXT_W + GAP) - GAP)
      : 0

  // Central rack, two columns: production (optional routers, then
  // superspines/exits, then spines) and management (mgmt servers and
  // firewalls over mgmt spines, aligned to the bottom rows).
  const hasRouters = central.routers.length > 0
  // On-prem control-plane nodes in the central rack share the top row with
  // the routers; a managed cluster is a capsule above the rack instead.
  const cpBox = partition.controlPlane?.managed ? undefined : partition.controlPlane?.node
  const row0 = [...central.routers, ...(cpBox ? [cpBox] : [])]
  const prodRow1W = rowWidth(central.superspines.length) + rowWidth(central.exits.length) + 56
  const prodW = Math.max(prodRow1W, rowWidth(central.spines.length), rowWidth(row0.length))
  const mgmtRow = mgmtServerRow(central)
  const mgmtW = Math.max(rowWidth(mgmtRow.length), rowWidth(central.mgmtSpines.length))
  const columnGap = prodW > 0 && mgmtW > 0 ? COLUMN_GAP : 0
  const centralInnerW = prodW + columnGap + mgmtW
  const fabricW = Math.max(racksW + storageW, centralInnerW + 2 * RACK_PAD, 300)
  const cx = fabricW / 2

  // The networks that attach in the central rack, and a managed control
  // plane, sit above it, centered over the exits.
  const capsules = [
    ...centralNets,
    ...(partition.controlPlane?.managed ? [partition.controlPlane.node] : []),
  ]
  const extH = capsules.length > 0 ? EXT_H + 28 : 0
  const boxTop = y0 + 24 + extH
  const row0Y = boxTop + RACK_HEAD
  const row1Y = row0.length > 0 ? row0Y + NODE_H + ROW_GAP : row0Y
  const row2Y = row1Y + NODE_H + ROW_GAP
  const innerLeft = cx - centralInnerW / 2
  const prodCx = innerLeft + prodW / 2
  const mgmtCx = innerLeft + prodW + columnGap + mgmtW / 2
  if (row0.length > 0) placeRow(rects, row0, prodCx, row0Y)
  placeGroupedRow(rects, central.superspines, central.exits, prodCx, row1Y)
  placeRow(rects, central.spines, prodCx, row2Y)
  placeRow(rects, mgmtRow, mgmtCx, row1Y)
  placeRow(rects, central.mgmtSpines, mgmtCx, row2Y)
  const boxRect: Rect = {
    x: innerLeft - RACK_PAD,
    y: boxTop,
    w: centralInnerW + 2 * RACK_PAD,
    h: row2Y + NODE_H + RACK_PAD - boxTop,
  }
  layout.boxes.push({ rect: boxRect, name: 'Central rack', target: { partitionId: partition.id } })
  if (capsules.length > 0) {
    const anchors = hasRouters ? central.routers : central.exits
    const exitRects = anchors.map((e) => rects.get(e.id)).filter((r): r is Rect => !!r)
    const ecx =
      exitRects.length > 0
        ? exitRects.reduce((sum, r) => sum + r.x + r.w / 2, 0) / exitRects.length
        : prodCx
    placeCapsules(rects, capsules, ecx, y0 + 24)
  }

  // Compute racks and the storage box below. The physical racks of a
  // rack group sit close together inside an enclosing box.
  const rackY = boxRect.y + boxRect.h + 56 + (hasPods ? POD_BAND : 0)
  let x = Math.max(0, (fabricW - racksW - storageW) / 2)
  let maxRackH = 0
  const rackBoxes: BoxLayout[] = []
  groups.forEach((group, g) => {
    const groupX = x
    const width = groupWidth(group)
    // A pod box goes in first, so it is drawn behind its racks; its size
    // is known once they are laid out.
    const podBox: BoxLayout | undefined = group.pod
      ? {
          rect: { x: groupX, y: rackY - POD_BAND, w: width, h: 0 },
          name: group.pod.name,
          pod: true,
        }
      : undefined
    if (podBox) {
      layout.boxes.push(podBox)
      placeRow(rects, group.pod!.spines, groupX + width / 2, rackY - POD_BAND + RACK_HEAD)
    }
    x = groupX + (width - racksRowWidth(group.racks)) / 2
    const groupRackH = layoutRackRow(group.racks)
    if (podBox) podBox.rect.h = POD_BAND + groupRackH + POD_PAD
    maxRackH = Math.max(maxRackH, groupRackH + (podBox ? POD_PAD : 0))
    x = groupX + width + (g < groups.length - 1 ? RACK_GAP : 0)
  })

  /** Lays out a row of racks from x at rackY; returns its height. */
  function layoutRackRow(racks: TopoRack[]): number {
    let rowH = 0
    let entityStartX = 0
    racks.forEach((rack, i) => {
      const prev = racks[i - 1]
      const next = racks[i + 1]
      const startsEntity = !!rack.entity && !sameEntity(prev, rack)
      const endsEntity = !!rack.entity && !sameEntity(rack, next)
      if (startsEntity) {
        entityStartX = x
        x += ENTITY_PAD
      }
      const rl = layoutRack(rects, rack, x, rackY, partition.id)
      rackBoxes.push(rl)
      rowH = Math.max(rowH, rl.rect.h)
      x += rl.rect.w
      if (endsEntity) {
        x += ENTITY_PAD
        const entityRacks = rackBoxes.filter((b) => b.rect.x >= entityStartX)
        const h = Math.max(...entityRacks.map((b) => b.rect.h))
        layout.boxes.push({
          rect: {
            x: entityStartX,
            y: rackY - ENTITY_HEAD,
            w: x - entityStartX,
            h: h + ENTITY_HEAD + ENTITY_PAD,
          },
          name: rack.entity!.name,
          entity: true,
          target: { partitionId: partition.id, rackId: rack.entity!.id },
        })
        rowH = Math.max(rowH, h + ENTITY_PAD)
      }
      if (next) x += sameEntity(rack, next) ? ENTITY_GAP : RACK_GAP
    })
    return rowH
  }
  layout.boxes.push(...rackBoxes)
  x += partition.racks.length > 0 ? RACK_GAP : 0
  if (partition.storageLeaves.length > 0) {
    const box: Rect = {
      x,
      y: rackY,
      w: NODE_W + 2 * RACK_PAD,
      h: RACK_HEAD + partition.storageLeaves.length * (NODE_H + 8) + RACK_PAD,
    }
    layout.boxes.push({ rect: box, name: 'Storage' })
    partition.storageLeaves.forEach((node, i) => {
      rects.set(node.id, {
        x: x + RACK_PAD,
        y: rackY + RACK_HEAD + i * (NODE_H + 8),
        w: NODE_W,
        h: NODE_H,
      })
    })
    // The storage networks go in the gap above the box, over the leaves
    // they attach to.
    placeCapsules(rects, storageNets, box.x + box.w / 2, rackY - EXT_H - 12)
    maxRackH = Math.max(maxRackH, box.h)
  }

  layout.partitionLabels.push({ x: 0, y: y0 + 14, name: partition.name })

  return { partW: fabricW, partH: rackY - y0 + maxRackH + 8 }
}

function computeLayout(graph: TopologyGraph): Layout {
  const layout: Layout = {
    width: 0,
    height: 0,
    rects: new Map(),
    boxes: [],
    partitionLabels: [],
  }

  let y = 0
  let maxW = 0
  for (const partition of graph.partitions) {
    const { partW, partH } = layoutPartition(layout, partition, y)
    maxW = Math.max(maxW, partW)
    y += partH + 40
  }

  layout.width = maxW + 2 * MARGIN
  layout.height = y - 40 + MARGIN
  return layout
}

interface Pt {
  x: number
  y: number
}

/** A server group being dragged towards another rack. */
interface GroupDrag {
  nodeId: string
  groupId: string
  from: Selection
  /** Pointer offset within the node, so the ghost does not jump. */
  grab: Pt
  start: Pt
  at: Pt
  /** Set once the pointer travelled DRAG_THRESHOLD; before that it is a click. */
  moved: boolean
  target?: DiagramTarget
}

/** Pointer travel, in diagram units, before a press on a group is a drag. */
const DRAG_THRESHOLD = 4

/** Anchor points and a curve between two rects: side-to-side only when
 *  both sit on the same row (spine ↔ mgmt spine, mgmt server ↔ mgmt spine),
 *  top/bottom otherwise — so every uplink from a compute rack leaves from
 *  the top of its switch and the curves fan out in one consistent
 *  direction instead of slicing horizontally through each other. */
function linkGeometry(from: Rect, to: Rect): { a: Pt; b: Pt; path: string } {
  const dxc = to.x + to.w / 2 - (from.x + from.w / 2)
  const dyc = to.y + to.h / 2 - (from.y + from.h / 2)
  if (Math.abs(dyc) < NODE_H / 2) {
    const a = { x: dxc > 0 ? from.x + from.w : from.x, y: from.y + from.h / 2 }
    const b = { x: dxc > 0 ? to.x : to.x + to.w, y: to.y + to.h / 2 }
    const mx = (a.x + b.x) / 2
    return { a, b, path: `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}` }
  }
  const a = { x: from.x + from.w / 2, y: dyc > 0 ? from.y + from.h : from.y }
  const b = { x: to.x + to.w / 2, y: dyc > 0 ? to.y : to.y + to.h }
  const my = (a.y + b.y) / 2
  return { a, b, path: `M ${a.x} ${a.y} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}` }
}

/** `capsule` draws the node as a dashed pill: external networks, and a
 *  managed control plane, which is somewhere else just the same. */
function NodeBox({ node, r, capsule }: { node: TopoNode; r: Rect; capsule?: boolean }) {
  const isServer =
    node.kind === 'server-group' || node.kind === 'mgmt-server' || node.kind === 'router'
  const isExternal = capsule ?? node.kind === 'external-network'
  const isMgmt =
    node.kind === 'mgmt-spine' ||
    node.kind === 'mgmt-leaf' ||
    node.kind === 'mgmt-server' ||
    node.kind === 'mgmt-firewall'

  const labelY = r.y + 18
  const subY = labelY + 12
  // Device glyph on the left; the text centres in the space next to it.
  const Glyph =
    node.kind === 'external-network' && node.networkKind
      ? EXTERNAL_NETWORK_ICON[node.networkKind]
      : NODE_ICON[node.kind]
  const glyphX = r.x + (isExternal ? 12 : 8)
  const textX = glyphX + GLYPH + (r.x + r.w - glyphX - GLYPH) / 2
  const glyphColor = isMgmt ? COLOR.mgmt : isExternal ? COLOR.gray400 : COLOR.gray500

  return (
    <g>
      <rect
        x={r.x}
        y={r.y}
        width={r.w}
        height={r.h}
        rx={isExternal ? r.h / 2 : 5}
        fill={isServer ? COLOR.page : COLOR.white}
        stroke={
          isServer ? 'none' : isExternal ? COLOR.gray400 : isMgmt ? COLOR.brand : COLOR.gray500
        }
        strokeWidth={1.1}
        strokeDasharray={isExternal ? '4 3' : undefined}
      />
      <Glyph
        x={glyphX}
        y={r.y + (r.h - GLYPH) / 2}
        width={GLYPH}
        height={GLYPH}
        color={glyphColor}
        aria-hidden="true"
      />
      <text
        x={textX}
        y={labelY}
        textAnchor="middle"
        fontSize={11}
        fontWeight={600}
        fill={COLOR.ink}
      >
        {node.label}
      </text>
      {node.sublabel && (
        <text x={textX} y={subY} textAnchor="middle" fontSize={9} fill={COLOR.gray500}>
          {node.sublabel}
        </text>
      )}
    </g>
  )
}

/** `fit` scales the drawing to its container's width (used for the
 *  live preview); otherwise it renders at natural size and only shrinks
 *  moderately wide diagrams to fit. */
export default function Diagram({
  graph,
  fit = false,
  onSelect,
  selected,
  onMoveGroup,
}: {
  graph: TopologyGraph
  fit?: boolean
  /** Click on a box (central rack, rack, rack group) or a node selects
   *  what it belongs to. */
  onSelect?: (target: DiagramTarget) => void
  /** Boxes belonging to this selection are outlined. */
  selected?: Selection
  /** A server group dragged from its rack and dropped on another rack. */
  onMoveGroup?: (from: Selection, groupId: string, to: Selection) => void
}) {
  const layout = computeLayout(graph)
  const { rects } = layout
  const content = useRef<SVGGElement>(null)
  const [drag, setDrag] = useState<GroupDrag | null>(null)
  // The click that ends a drag must not also select the dragged group.
  const dragEnded = useRef(false)

  function toContent(clientX: number, clientY: number): Pt | undefined {
    const m = content.current?.getScreenCTM()
    if (!m) return undefined
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }
  /** The rack of `partitionId` under a point, the innermost box first. */
  function rackAt(pt: Pt, partitionId: string | undefined): DiagramTarget | undefined {
    const hits = layout.boxes.filter(
      (b) =>
        b.target?.rackId &&
        b.target.partitionId === partitionId &&
        pt.x >= b.rect.x &&
        pt.x <= b.rect.x + b.rect.w &&
        pt.y >= b.rect.y &&
        pt.y <= b.rect.y + b.rect.h,
    )
    return (hits.find((b) => !b.entity) ?? hits[0])?.target
  }
  const isDropTarget = (target: DiagramTarget | undefined) =>
    !!drag?.target &&
    !!target &&
    target.rackId === drag.target.rackId &&
    target.partitionId === drag.target.partitionId &&
    drag.target.rackId !== drag.from.rackId
  const selectionOf = nodeSelections(graph)
  const isSelected = (target: DiagramTarget | undefined) =>
    !!selected &&
    !!target &&
    !selected.section &&
    target.partitionId === selected.partitionId &&
    target.rackId === selected.rackId
  const [hover, setHover] = useState<string | null>(null)
  const interactive = !fit

  // Neighbours of the hovered node: its links and their far ends stay
  // fully visible, everything else fades.
  const neighbours = new Set<string>()
  if (hover) {
    for (const l of graph.links) {
      if (l.from === hover) neighbours.add(l.to)
      if (l.to === hover) neighbours.add(l.from)
    }
  }
  // While a group is dragged the hover fade would dim the drop targets.
  const nodeOpacity = (id: string) =>
    !hover || drag?.moved || id === hover || neighbours.has(id) ? 1 : 0.35
  const linkTouches = (l: TopoLink) => !!hover && (l.from === hover || l.to === hover)
  const fading = !!hover && !drag?.moved

  const allNodes: TopoNode[] = [
    ...graph.partitions.flatMap((p) => [
      ...p.externalNetworks,
      ...p.central.routers,
      ...p.central.superspines,
      ...p.central.spines,
      ...p.central.exits,
      ...p.central.mgmtSpines,
      ...p.central.mgmtServers,
      ...p.central.mgmtFirewalls,
      ...p.storageLeaves,
      ...p.pods.flatMap((pod) => pod.spines),
      ...(p.controlPlane ? [p.controlPlane.node] : []),
      ...p.racks.flatMap((r) => [...r.leaves, ...r.mgmtLeaves, ...r.serverGroups]),
    ]),
  ]

  // Nodes drawn as dashed pills above the central rack.
  const capsuleIds = new Set(
    graph.partitions.flatMap((p) => [
      ...p.externalNetworks.map((n) => n.id),
      ...(p.controlPlane?.managed ? [p.controlPlane.node.id] : []),
    ]),
  )

  const showPartitionLabels = graph.partitions.length > 1

  return (
    <svg
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      style={fit ? { width: '100%', height: 'auto' } : { display: 'block' }}
      role="img"
      aria-label="Topology diagram"
    >
      <g ref={content} transform={`translate(${MARGIN} 0)`}>
        {layout.boxes.map((box, i) => (
          <g
            key={i}
            onClick={
              interactive && box.target && onSelect ? () => onSelect(box.target!) : undefined
            }
            style={interactive && box.target && onSelect ? { cursor: 'pointer' } : undefined}
          >
            {interactive && box.target && onSelect && <title>Select {box.name}</title>}
            <rect
              x={box.rect.x}
              y={box.rect.y}
              width={box.rect.w}
              height={box.rect.h}
              rx={8}
              fill={
                isDropTarget(box.target)
                  ? COLOR.brandTint
                  : box.pod
                    ? COLOR.white
                    : box.entity
                      ? COLOR.gray100
                      : COLOR.gray50
              }
              stroke={
                isSelected(box.target) || isDropTarget(box.target)
                  ? COLOR.brand
                  : box.entity || box.pod
                    ? COLOR.gray300
                    : COLOR.gray200
              }
              strokeWidth={isSelected(box.target) || isDropTarget(box.target) ? 2 : 1}
              strokeDasharray={box.entity || isDropTarget(box.target) ? '5 4' : undefined}
            />
            <text
              x={box.rect.x + RACK_PAD}
              y={box.rect.y + 13}
              fontSize={9.5}
              fontWeight={600}
              fill={COLOR.gray500}
            >
              {box.name}
            </text>
          </g>
        ))}
        {showPartitionLabels &&
          layout.partitionLabels.map((p, i) => (
            <text key={i} x={p.x} y={p.y} fontSize={12} fontWeight={700} fill={COLOR.gray700}>
              {p.name}
            </text>
          ))}
        {graph.links.map((link, i) => {
          const from = rects.get(link.from)
          const to = rects.get(link.to)
          if (!from || !to) return null
          const { path } = linkGeometry(from, to)
          const color = linkColor(link)
          return (
            <g key={i}>
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={LINK_WIDTH[link.speed ?? 'none'] + (linkTouches(link) ? 0.9 : 0)}
                strokeDasharray={link.network === 'external' ? '5 4' : undefined}
                opacity={!fading ? 0.75 : linkTouches(link) ? 1 : 0.12}
              />
              <path
                className="topo-flow"
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={LINK_WIDTH[link.speed ?? 'none'] + 0.6}
                opacity={!fading ? 1 : linkTouches(link) ? 1 : 0.1}
                style={{
                  animationDuration: `${FLOW_DURATION[link.speed ?? 'none']}s`,
                  animationDelay: `${(i % 7) * -0.6}s`,
                }}
              />
            </g>
          )
        })}
        {allNodes.map((node) => {
          const r = rects.get(node.id)
          const from = selectionOf.get(node.id)
          const draggable = interactive && !!onMoveGroup && !!node.groupId && !!from?.rackId
          return r ? (
            <g
              key={node.id}
              opacity={drag?.nodeId === node.id && drag.moved ? 0.35 : nodeOpacity(node.id)}
              onMouseEnter={interactive ? () => setHover(node.id) : undefined}
              onMouseLeave={interactive ? () => setHover(null) : undefined}
              onClick={
                interactive && onSelect && from
                  ? (e) => {
                      e.stopPropagation()
                      if (dragEnded.current) {
                        dragEnded.current = false
                        return
                      }
                      onSelect(from)
                    }
                  : undefined
              }
              onPointerDown={
                draggable
                  ? (e) => {
                      if (e.button !== 0) return
                      e.stopPropagation()
                      e.currentTarget.setPointerCapture(e.pointerId)
                      const at = toContent(e.clientX, e.clientY)
                      if (!at) return
                      setDrag({
                        nodeId: node.id,
                        groupId: node.groupId!,
                        from: from!,
                        grab: { x: at.x - r.x, y: at.y - r.y },
                        start: at,
                        at,
                        moved: false,
                      })
                    }
                  : undefined
              }
              onPointerMove={
                draggable
                  ? (e) => {
                      if (drag?.nodeId !== node.id) return
                      const at = toContent(e.clientX, e.clientY)
                      if (!at) return
                      const moved =
                        drag.moved ||
                        Math.hypot(at.x - drag.start.x, at.y - drag.start.y) >= DRAG_THRESHOLD
                      setDrag({
                        ...drag,
                        at,
                        moved,
                        target: moved ? rackAt(at, drag.from.partitionId) : undefined,
                      })
                    }
                  : undefined
              }
              onPointerUp={
                draggable
                  ? () => {
                      if (drag?.nodeId !== node.id) return
                      if (drag.moved) {
                        dragEnded.current = true
                        if (drag.target && drag.target.rackId !== drag.from.rackId) {
                          onMoveGroup!(drag.from, drag.groupId, drag.target)
                        }
                      }
                      setDrag(null)
                    }
                  : undefined
              }
              onPointerCancel={draggable ? () => setDrag(null) : undefined}
              style={
                draggable
                  ? { cursor: drag?.moved ? 'grabbing' : 'grab', touchAction: 'none' }
                  : interactive && onSelect
                    ? { cursor: 'pointer' }
                    : undefined
              }
            >
              {draggable && <title>Drag onto another rack to move this group</title>}
              <NodeBox node={node} r={r} capsule={capsuleIds.has(node.id)} />
            </g>
          ) : null
        })}
        {drag?.moved &&
          (() => {
            const node = allNodes.find((n) => n.id === drag.nodeId)
            const r = rects.get(drag.nodeId)
            if (!node || !r) return null
            const ghost = { ...r, x: drag.at.x - drag.grab.x, y: drag.at.y - drag.grab.y }
            return (
              <g opacity={0.75} pointerEvents="none">
                <NodeBox node={node} r={ghost} />
              </g>
            )
          })()}
      </g>
    </svg>
  )
}
