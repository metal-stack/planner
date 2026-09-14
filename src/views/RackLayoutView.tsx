import {
  deriveRackLayout,
  formatPower,
  type RackElevation,
  type SlotKind,
} from '../derive/rackLayout'
import { usePlanStore } from '../store/planStore'
import { Icon, SLOT_ICON } from './icons'
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

function Rack({ rack, onClick }: { rack: RackElevation; onClick?: () => void }) {
  const overflowU = Math.max(0, rack.usedU - rack.heightUnits)
  const bodyH = (rack.heightUnits + overflowU) * U_PX
  const width = RAIL_W + SLOT_W + 8
  const height = HEAD_H + bodyH + 10
  const yOfTopU = (topU: number) => HEAD_H + (rack.heightUnits - topU) * U_PX

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={`${rack.name} elevation`}
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
        {overflowU > 0 ? ` — ${overflowU}U over` : ''} · ~{formatPower(rack.powerWatts)} of{' '}
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
        stroke="#9ca3af"
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
        return (
          <g key={i}>
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
            <title>{`${slot.label} — ${slot.sublabel ?? ''} (${uRange}, ${slot.units}U)`}</title>
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

export default function RackLayoutView() {
  const plan = usePlanStore((s) => s.plan)
  const partitions = deriveRackLayout(plan)
  const goTo = (partitionId: string, rackId?: string) => navigateTo({ partitionId, rackId })
  const showPartitionNames = partitions.length > 1

  return (
    <div className="space-y-8">
      {partitions.map((partition) => (
        <section key={partition.partitionId}>
          {showPartitionNames && (
            <h3 className="mb-3 text-sm font-semibold text-gray-700">{partition.partitionName}</h3>
          )}
          <div className="flex flex-wrap gap-6 card p-4">
            {partition.racks.map((rack) => (
              <Rack
                key={rack.id}
                rack={rack}
                onClick={() => goTo(partition.partitionId, rack.rackId)}
              />
            ))}
            <p className="w-full text-xs text-gray-500">
              Estimated power, all racks: ~
              {formatPower(partition.racks.reduce((w, r) => w + r.powerWatts, 0))} · per-device
              figures in the catalog, partial chassis scaled by node count
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
    </div>
  )
}
