import { useState } from 'react'
import { EXTERNAL_NETWORK_ICON, NODE_ICON } from '../icons'
import { COLOR } from '../colors'
import type {
  TopoLink,
  TopoNode,
  TopologyGraph,
  TopoPartition,
  TopoRack,
} from '../../derive/topology'

// Renders the derived TopologyGraph as a fabric elevation. Each partition
// draws its central rack as one physical unit with two columns: production
// gear on the left (exits/superspines above the spines) and management gear
// on the right (mgmt servers above the mgmt spines). Keeping both tiers
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
  management: COLOR.mgmt,
  external: COLOR.gray500,
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

/** Editor section a diagram element belongs to (see views/plan/navigate). */
export interface DiagramTarget {
  partitionId: string
  rackId?: string
}

interface BoxLayout {
  rect: Rect
  name: string
  /** Enclosing box of a rack group (drawn dashed, behind its racks). */
  entity?: boolean
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

function layoutPartition(
  layout: Layout,
  partition: TopoPartition,
  y0: number,
): { partW: number; partH: number } {
  const { rects } = layout
  const { central } = partition

  const racksW = racksRowWidth(partition.racks)
  const storageW = partition.storageLeaves.length > 0 ? NODE_W + 2 * RACK_PAD + 24 : 0

  // Central rack, two columns: production (optional routers, then
  // superspines/exits, then spines) and management (mgmt servers over mgmt
  // spines, aligned to the bottom rows).
  const hasRouters = central.routers.length > 0
  // On-prem control-plane nodes in the central rack share the top row with
  // the routers; a managed cluster is a capsule above the rack instead.
  const cpBox = partition.controlPlane?.managed ? undefined : partition.controlPlane?.node
  const row0 = [...central.routers, ...(cpBox ? [cpBox] : [])]
  const prodRow1W = rowWidth(central.superspines.length) + rowWidth(central.exits.length) + 56
  const prodW = Math.max(prodRow1W, rowWidth(central.spines.length), rowWidth(row0.length))
  const mgmtW = Math.max(rowWidth(central.mgmtServers.length), rowWidth(central.mgmtSpines.length))
  const columnGap = prodW > 0 && mgmtW > 0 ? COLUMN_GAP : 0
  const centralInnerW = prodW + columnGap + mgmtW
  const fabricW = Math.max(racksW + storageW, centralInnerW + 2 * RACK_PAD, 300)
  const cx = fabricW / 2

  // External networks, and a managed control plane, sit above the central
  // rack, centered over the exits.
  const capsules = [
    ...partition.externalNetworks,
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
  placeRow(rects, central.mgmtServers, mgmtCx, row1Y)
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
    const total = capsules.length * (EXT_W + GAP) - GAP
    let ex = ecx - total / 2
    for (const node of capsules) {
      rects.set(node.id, { x: ex, y: y0 + 24, w: EXT_W, h: EXT_H })
      ex += EXT_W + GAP
    }
  }

  // Compute racks and the storage box below. The physical racks of a
  // rack group sit close together inside an enclosing box.
  const rackY = boxRect.y + boxRect.h + 56
  let x = Math.max(0, (fabricW - racksW - storageW) / 2)
  let maxRackH = 0
  const rackBoxes: BoxLayout[] = []
  let entityStartX = 0
  partition.racks.forEach((rack, i) => {
    const prev = partition.racks[i - 1]
    const next = partition.racks[i + 1]
    const startsEntity = !!rack.entity && !sameEntity(prev, rack)
    const endsEntity = !!rack.entity && !sameEntity(rack, next)
    if (startsEntity) {
      entityStartX = x
      x += ENTITY_PAD
    }
    const rl = layoutRack(rects, rack, x, rackY, partition.id)
    rackBoxes.push(rl)
    maxRackH = Math.max(maxRackH, rl.rect.h)
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
      maxRackH = Math.max(maxRackH, h + ENTITY_PAD)
    }
    if (next) x += sameEntity(rack, next) ? ENTITY_GAP : RACK_GAP
  })
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
    node.kind === 'mgmt-spine' || node.kind === 'mgmt-leaf' || node.kind === 'mgmt-server'

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
  onNavigate,
}: {
  graph: TopologyGraph
  fit?: boolean
  /** Click on a rack, rack group or central rack box → jump to its editor section. */
  onNavigate?: (target: DiagramTarget) => void
}) {
  const layout = computeLayout(graph)
  const { rects } = layout
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
  const nodeOpacity = (id: string) => (!hover || id === hover || neighbours.has(id) ? 1 : 0.35)
  const linkTouches = (l: TopoLink) => !!hover && (l.from === hover || l.to === hover)

  const allNodes: TopoNode[] = [
    ...graph.partitions.flatMap((p) => [
      ...p.externalNetworks,
      ...p.central.routers,
      ...p.central.superspines,
      ...p.central.spines,
      ...p.central.exits,
      ...p.central.mgmtSpines,
      ...p.central.mgmtServers,
      ...p.storageLeaves,
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
      <g transform={`translate(${MARGIN} 0)`}>
        {layout.boxes.map((box, i) => (
          <g
            key={i}
            onClick={
              interactive && box.target && onNavigate ? () => onNavigate(box.target!) : undefined
            }
            style={interactive && box.target && onNavigate ? { cursor: 'pointer' } : undefined}
          >
            {interactive && box.target && onNavigate && <title>Edit {box.name} in the plan</title>}
            <rect
              x={box.rect.x}
              y={box.rect.y}
              width={box.rect.w}
              height={box.rect.h}
              rx={8}
              fill={box.entity ? COLOR.gray100 : COLOR.gray50}
              stroke={box.entity ? COLOR.gray300 : COLOR.gray200}
              strokeDasharray={box.entity ? '5 4' : undefined}
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
          const color = LINK_COLOR[link.network]
          return (
            <g key={i}>
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={LINK_WIDTH[link.speed ?? 'none'] + (linkTouches(link) ? 0.9 : 0)}
                strokeDasharray={link.network === 'external' ? '5 4' : undefined}
                opacity={!hover ? 0.75 : linkTouches(link) ? 1 : 0.12}
              />
              <path
                className="topo-flow"
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={LINK_WIDTH[link.speed ?? 'none'] + 0.6}
                opacity={!hover ? 1 : linkTouches(link) ? 1 : 0.1}
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
          return r ? (
            <g
              key={node.id}
              opacity={nodeOpacity(node.id)}
              onMouseEnter={interactive ? () => setHover(node.id) : undefined}
              onMouseLeave={interactive ? () => setHover(null) : undefined}
            >
              <NodeBox node={node} r={r} capsule={capsuleIds.has(node.id)} />
            </g>
          ) : null
        })}
      </g>
    </svg>
  )
}
