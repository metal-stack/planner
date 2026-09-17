import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  deriveRackLayout,
  formatPower,
  type RackElevation,
  type RackSlot,
  type SlotKind,
} from '../derive/rackLayout'
import { leafPortsAvailable, leafPortsNeeded } from '../derive/validate'
import type { ServerGroup } from '../model/plan'
import { usePlanStore } from '../store/planStore'
import { useToastStore } from '../store/toastStore'
import { Icon, SECTION_ICON, SLOT_ICON } from './icons'
import { navigateTo } from './plan/navigate'

// Rack elevations with a height-unit scale. U numbers count from the
// bottom (U1) to the top, the way physical racks are labeled; devices fill
// from the top.

const U_PX = 12
const RAIL_W = 26
const SLOT_W = 168
const HEAD_H = 40

const SLOT_STYLE: Record<SlotKind, { fill: string; stroke: string; text: string }> = {
  network: { fill: '#ffffff', stroke: '#6b7280', text: '#1c1e21' },
  mgmt: { fill: '#fffbeb', stroke: '#f59e0b', text: '#1c1e21' },
  server: { fill: '#f5f6f7', stroke: '#d1d5db', text: '#1c1e21' },
  storage: { fill: '#e0f2fe', stroke: '#7dd3fc', text: '#0c4a6e' },
}

interface DragSource {
  partitionId: string
  rackId: string
  elevationId: string
  slotIndex: number
  groupId: string
  nodes: number
  uplink: ServerGroup['uplink']
  role: ServerGroup['role']
  label: string
  sublabel?: string
}

interface DragState {
  source: DragSource
  x: number
  y: number
  targetRackId: string | null
}

type DropState = 'idle' | 'valid' | 'hover' | 'hoverOverflow'
type ChassisHandlers = (
  slot: RackSlot,
  slotIndex: number,
) => {
  onPointerDown: (event: ReactPointerEvent<SVGGElement>) => void
  onPointerMove: (event: ReactPointerEvent<SVGGElement>) => void
  onPointerUp: (event: ReactPointerEvent<SVGGElement>) => void
  onPointerCancel: (event: ReactPointerEvent<SVGGElement>) => void
}

function hitTest(event: ReactPointerEvent, source: DragSource): string | null {
  const element = document.elementFromPoint(event.clientX, event.clientY)
  const svg = element?.closest('svg[data-rack-id]')
  if (!svg) return null
  if (svg.getAttribute('data-partition-id') !== source.partitionId) return null
  const rackId = svg.getAttribute('data-rack-id')
  return rackId === source.rackId ? null : rackId
}

function Rack({
  partitionId,
  rack,
  onClick,
  dragSource,
  dropState,
  chassisHandlers,
}: {
  partitionId: string
  rack: RackElevation
  onClick?: () => void
  dragSource?: DragSource
  dropState: DropState
  chassisHandlers?: ChassisHandlers
}) {
  const overflowU = Math.max(0, rack.usedU - rack.heightUnits)
  const bodyH = (rack.heightUnits + overflowU) * U_PX
  const width = RAIL_W + SLOT_W + 8
  const height = HEAD_H + bodyH + 10
  const yOfTopU = (topU: number) => HEAD_H + (rack.heightUnits - topU) * U_PX
  const highlighted = dropState !== 'idle'
  const hovered = dropState === 'hover' || dropState === 'hoverOverflow'

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={`${rack.name} elevation`}
      data-partition-id={partitionId}
      data-rack-id={rack.rackId}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      {onClick && <title>Edit {rack.name} in the plan</title>}
      <text x={RAIL_W} y={14} fontSize={11.5} fontWeight={700} fill="#1c1e21">
        {rack.name}
      </text>
      <text
        x={RAIL_W}
        y={28}
        fontSize={9}
        fill={overflowU > 0 || rack.powerWatts > rack.maxPowerWatts ? '#b91c1c' : '#6b7280'}
      >
        {rack.usedU}U of {rack.heightUnits}U used
        {overflowU > 0 ? `, ${overflowU}U over` : ''} · ~{formatPower(rack.powerWatts)} of{' '}
        {formatPower(rack.maxPowerWatts)}
      </text>

      {/* U scale: a tick per unit, a number every 5 plus the top unit. */}
      {Array.from({ length: rack.heightUnits }, (_, i) => {
        const u = rack.heightUnits - i
        const y = HEAD_H + i * U_PX
        const numbered = u % 5 === 0 || u === rack.heightUnits || u === 1
        return (
          <g key={u}>
            <line x1={RAIL_W - 4} y1={y} x2={RAIL_W} y2={y} stroke="#d1d5db" />
            {numbered && (
              <text x={RAIL_W - 7} y={y + U_PX - 3} textAnchor="end" fontSize={7.5} fill="#9ca3af">
                {u}
              </text>
            )}
          </g>
        )
      })}

      {/* Rack interior with a faint line per unit. */}
      <rect
        x={RAIL_W}
        y={HEAD_H}
        width={SLOT_W}
        height={rack.heightUnits * U_PX}
        fill="#fcfcfd"
        stroke={dropState === 'hoverOverflow' ? '#dc2626' : highlighted ? '#f59e0b' : '#9ca3af'}
        strokeWidth={hovered ? 2 : 1}
        strokeDasharray={highlighted && !hovered ? '4 3' : undefined}
      />
      {Array.from({ length: rack.heightUnits - 1 }, (_, i) => (
        <line
          key={i}
          x1={RAIL_W}
          y1={HEAD_H + (i + 1) * U_PX}
          x2={RAIL_W + SLOT_W}
          y2={HEAD_H + (i + 1) * U_PX}
          stroke="#f3f4f6"
        />
      ))}

      {rack.slots.map((slot, i) => {
        const style = SLOT_STYLE[slot.kind]
        const overflowing = slot.topU - slot.units < 0
        const y = yOfTopU(slot.topU)
        const h = slot.units * U_PX
        const centerY = y + h / 2
        const bottomU = slot.topU - slot.units + 1
        const uRange = slot.units > 1 ? `U${bottomU}–${slot.topU}` : `U${slot.topU}`
        const draggable = rack.rackId != null && slot.groupId != null
        const dragged = dragSource?.elevationId === rack.id && dragSource.slotIndex === i
        return (
          <g
            key={i}
            opacity={dragged ? 0.35 : 1}
            {...(draggable ? chassisHandlers?.(slot, i) : {})}
            style={
              draggable
                ? { cursor: dragSource ? 'grabbing' : 'grab', touchAction: 'none' }
                : undefined
            }
          >
            <rect
              x={RAIL_W + 1}
              y={y + 1}
              width={SLOT_W - 2}
              height={h - 2}
              rx={2}
              fill={overflowing ? '#fee2e2' : style.fill}
              stroke={overflowing ? '#dc2626' : style.stroke}
              strokeWidth={1}
            />
            <title>{`${slot.label}: ${slot.sublabel ?? ''} (${uRange}, ${slot.units}U)`}</title>
            {slot.units === 1 ? (
              <>
                <text
                  x={RAIL_W + 6}
                  y={centerY + 2.5}
                  fontSize={7.5}
                  fontWeight={600}
                  fill={style.text}
                >
                  {slot.label}
                </text>
                <text
                  x={RAIL_W + SLOT_W - 6}
                  y={centerY + 2.5}
                  textAnchor="end"
                  fontSize={7}
                  fill="#6b7280"
                >
                  {slot.sublabel}
                </text>
              </>
            ) : (
              <>
                {(() => {
                  const Glyph = SLOT_ICON[slot.kind]
                  return (
                    <Glyph
                      x={RAIL_W + 7}
                      y={centerY - 6}
                      width={12}
                      height={12}
                      color="#6b7280"
                      aria-hidden="true"
                    />
                  )
                })()}
                <text
                  x={RAIL_W + SLOT_W / 2}
                  y={centerY - 2}
                  textAnchor="middle"
                  fontSize={8.5}
                  fontWeight={600}
                  fill={style.text}
                >
                  {slot.label}
                </text>
                <text
                  x={RAIL_W + SLOT_W / 2}
                  y={centerY + 8}
                  textAnchor="middle"
                  fontSize={7.5}
                  fill="#6b7280"
                >
                  {slot.sublabel} · {uRange}
                </text>
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** Consecutive elevations of one rack group, or a lone rack, in order. */
function groupRuns(
  racks: RackElevation[],
): { group?: RackElevation['group']; racks: RackElevation[] }[] {
  const runs: { group?: RackElevation['group']; racks: RackElevation[] }[] = []
  for (const rack of racks) {
    const last = runs.at(-1)
    if (rack.group && last?.group?.id === rack.group.id) last.racks.push(rack)
    else runs.push({ group: rack.group, racks: [rack] })
  }
  return runs
}

export default function RackLayoutView() {
  const plan = usePlanStore((state) => state.plan)
  const moveChassis = usePlanStore((state) => state.moveChassis)
  const notify = useToastStore((state) => state.notify)
  const [drag, setDrag] = useState<DragState | null>(null)
  const pending = useRef<{
    pointerId: number
    startX: number
    startY: number
    source: DragSource
  } | null>(null)
  const suppressClick = useRef(false)
  const cancelledPointerId = useRef<number | null>(null)
  const partitions = deriveRackLayout(plan)
  const showPartitionNames = partitions.length > 1
  const targetRackId = drag?.targetRackId
  const sourcePartitionId = drag?.source.partitionId
  const sourceNodes = drag?.source.nodes
  const sourceRole = drag?.source.role
  const sourceUplink = drag?.source.uplink

  const targetOverflows = useMemo(() => {
    if (
      !targetRackId ||
      !sourcePartitionId ||
      sourceNodes == null ||
      !sourceRole ||
      !sourceUplink
    ) {
      return false
    }
    const partition = plan.partitions.find((candidate) => candidate.id === sourcePartitionId)
    const target = partition?.racks.find((rack) => rack.id === targetRackId)
    if (!partition || !target) return false
    const pseudo = {
      ...target,
      servers: [
        ...target.servers,
        {
          id: 'drag-preview',
          modelId: '',
          role: sourceRole,
          count: sourceNodes,
          uplink: sourceUplink,
        },
      ],
    }
    return leafPortsNeeded(pseudo) > leafPortsAvailable(target, partition)
  }, [plan, sourceNodes, sourcePartitionId, sourceRole, sourceUplink, targetRackId])

  useEffect(() => {
    if (!drag) return
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      suppressClick.current = true
      cancelledPointerId.current = pending.current?.pointerId ?? null
      pending.current = null
      setDrag(null)
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [drag])

  const goTo = (partitionId: string, rackId?: string) => navigateTo({ partitionId, rackId })

  function handlersFor(partitionId: string, rack: RackElevation): ChassisHandlers {
    return (slot, slotIndex) => ({
      onPointerDown: (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        const partition = plan.partitions.find((candidate) => candidate.id === partitionId)
        const planRack = partition?.racks.find((candidate) => candidate.id === rack.rackId)
        const group = planRack?.servers.find((candidate) => candidate.id === slot.groupId)
        if (!rack.rackId || !slot.groupId || slot.nodes == null || !group) return
        cancelledPointerId.current = null
        suppressClick.current = false
        pending.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          source: {
            partitionId,
            rackId: rack.rackId,
            elevationId: rack.id,
            slotIndex,
            groupId: slot.groupId,
            nodes: slot.nodes,
            uplink: group.uplink,
            role: group.role,
            label: slot.label,
            sublabel: slot.sublabel,
          },
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      },
      onPointerMove: (event) => {
        const waiting = pending.current
        if (!waiting || waiting.pointerId !== event.pointerId) return
        const moved = Math.hypot(event.clientX - waiting.startX, event.clientY - waiting.startY)
        if (!drag && moved <= 5) return
        setDrag({
          source: waiting.source,
          x: event.clientX,
          y: event.clientY,
          targetRackId: hitTest(event, waiting.source),
        })
      },
      onPointerUp: (event) => {
        const waiting = pending.current
        if (!waiting || waiting.pointerId !== event.pointerId) {
          if (cancelledPointerId.current === event.pointerId) {
            cancelledPointerId.current = null
            setTimeout(() => {
              suppressClick.current = false
            }, 0)
          }
          return
        }
        pending.current = null
        if (!drag) return

        if (drag.targetRackId) {
          const target = plan.partitions
            .find((partition) => partition.id === drag.source.partitionId)
            ?.racks.find((candidate) => candidate.id === drag.targetRackId)
          const before = usePlanStore.getState().plan
          moveChassis({
            partitionId: drag.source.partitionId,
            fromRackId: drag.source.rackId,
            groupId: drag.source.groupId,
            nodes: drag.source.nodes,
            toRackId: drag.targetRackId,
          })
          if (target && usePlanStore.getState().plan !== before) {
            const { nodes, role } = drag.source
            notify(`Moved ${nodes} × ${role} node${nodes === 1 ? '' : 's'} to ${target.name}.`, {
              action: {
                label: 'Undo',
                onClick: () => usePlanStore.temporal.getState().undo(),
              },
            })
          }
        }
        suppressClick.current = true
        setTimeout(() => {
          suppressClick.current = false
        }, 0)
        setDrag(null)
      },
      onPointerCancel: (event) => {
        if (
          pending.current?.pointerId !== event.pointerId &&
          cancelledPointerId.current !== event.pointerId
        ) {
          return
        }
        pending.current = null
        cancelledPointerId.current = null
        suppressClick.current = true
        setTimeout(() => {
          suppressClick.current = false
        }, 0)
        setDrag(null)
      },
    })
  }

  function renderRack(partitionId: string, rack: RackElevation) {
    const validTarget =
      drag != null &&
      rack.rackId != null &&
      partitionId === drag.source.partitionId &&
      rack.rackId !== drag.source.rackId
    const hovered = validTarget && rack.rackId === drag.targetRackId
    const dropState: DropState = hovered
      ? targetOverflows
        ? 'hoverOverflow'
        : 'hover'
      : validTarget
        ? 'valid'
        : 'idle'
    return (
      <Rack
        key={rack.id}
        partitionId={partitionId}
        rack={rack}
        dragSource={drag?.source}
        dropState={dropState}
        chassisHandlers={handlersFor(partitionId, rack)}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false
            return
          }
          goTo(partitionId, rack.rackId)
        }}
      />
    )
  }

  return (
    <div className={`space-y-8 ${drag ? 'cursor-grabbing select-none' : ''}`}>
      {partitions.map((partition) => (
        <section key={partition.partitionId}>
          {showPartitionNames && (
            <h3 className="mb-3 text-sm font-semibold text-gray-700">{partition.partitionName}</h3>
          )}
          <div className="flex flex-wrap gap-6 card p-4">
            {groupRuns(partition.racks).map((run) =>
              run.group ? (
                <div
                  key={run.group.id}
                  className="rounded-md border border-dashed border-gray-300 bg-gray-50/60 px-2 pt-1.5"
                >
                  <button
                    type="button"
                    onClick={() => goTo(partition.partitionId, run.group!.id)}
                    title={`Edit ${run.group.name} in the plan`}
                    className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:underline"
                  >
                    <Icon icon={SECTION_ICON.rackGroup} className="h-3.5 w-3.5 text-gray-500" />
                    {run.group.name}
                    <span className="font-normal text-gray-500">
                      · leaf pair and mgmt leaf in {run.racks[1]?.name}
                    </span>
                  </button>
                  <div className="flex gap-3">
                    {run.racks.map((rack) => renderRack(partition.partitionId, rack))}
                  </div>
                </div>
              ) : (
                run.racks.map((rack) => renderRack(partition.partitionId, rack))
              ),
            )}
            <p className="w-full text-xs text-gray-500">
              Estimated power, all racks: ~
              {formatPower(partition.racks.reduce((watts, rack) => watts + rack.powerWatts, 0))} ·
              per-device figures in the catalog, partial chassis scaled by node count
            </p>
          </div>
        </section>
      ))}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-600">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-gray-500 bg-white" />
          <Icon icon={SLOT_ICON.network} className="h-3.5 w-3.5 text-gray-500" />
          Network
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-brand bg-amber-50" />
          <Icon icon={SLOT_ICON.mgmt} className="h-3.5 w-3.5 text-gray-500" />
          Management
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-gray-300 bg-page" />
          <Icon icon={SLOT_ICON.server} className="h-3.5 w-3.5 text-gray-500" />
          Servers
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-sky-300 bg-sky-100" />
          <Icon icon={SLOT_ICON.storage} className="h-3.5 w-3.5 text-gray-500" />
          Storage
        </span>
      </div>
      {drag && (
        <div
          className="pointer-events-none fixed z-50 rounded border border-brand bg-white px-2 py-1 text-xs shadow"
          style={{ left: drag.x + 10, top: drag.y + 8 }}
        >
          <div className="font-semibold">{drag.source.label}</div>
          {drag.source.sublabel && <div className="text-gray-500">{drag.source.sublabel}</div>}
        </div>
      )}
    </div>
  )
}
