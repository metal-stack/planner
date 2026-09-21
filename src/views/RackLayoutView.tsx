import {
  deriveRackLayout,
  formatPower,
  type RackElevation,
  type SlotKind,
} from '../derive/rackLayout'
import { usePlanStore } from '../store/planStore'
import { Icon, SECTION_ICON, SLOT_ICON } from './icons'
import { COLOR } from './colors'
import { navigateTo } from './plan/navigate'

// Rack elevations with a height-unit scale. U numbers count from the
// bottom (U1) to the top, the way physical racks are labeled; devices fill
// from the top.

const U_PX = 18
const RAIL_W = 30
const SLOT_W = 220
const HEAD_H = 56
/** Height of the U and power meters in the rack header. */
const METER_H = 5

const SLOT_STYLE: Record<SlotKind, { fill: string; stroke: string; text: string }> = {
  network: { fill: COLOR.white, stroke: COLOR.gray500, text: COLOR.ink },
  mgmt: { fill: COLOR.brandTint, stroke: COLOR.brand, text: COLOR.ink },
  server: { fill: COLOR.page, stroke: COLOR.gray300, text: COLOR.ink },
  storage: { fill: COLOR.storageTint, stroke: COLOR.storageLine, text: COLOR.storageText },
}

/** A labeled usage bar in the rack header; red once the budget is exceeded. */
function Meter(props: {
  x: number
  y: number
  w: number
  used: number
  max: number
  label: string
}) {
  const over = props.used > props.max
  const share = props.max > 0 ? Math.min(1, props.used / props.max) : 1
  return (
    <g>
      <text x={props.x} y={props.y} fontSize={10.5} fill={over ? COLOR.dangerText : COLOR.gray500}>
        {props.label}
      </text>
      <rect
        x={props.x}
        y={props.y + 5}
        width={props.w}
        height={METER_H}
        rx={METER_H / 2}
        fill={COLOR.gray200}
      />
      <rect
        x={props.x}
        y={props.y + 5}
        width={props.w * share}
        height={METER_H}
        rx={METER_H / 2}
        fill={over ? COLOR.danger : COLOR.gray500}
      />
    </g>
  )
}

function Rack({ rack, onClick }: { rack: RackElevation; onClick?: () => void }) {
  const overflowU = Math.max(0, rack.usedU - rack.heightUnits)
  const bodyH = (rack.heightUnits + overflowU) * U_PX
  const width = RAIL_W + SLOT_W + 8
  const height = HEAD_H + bodyH + 10
  const yOfTopU = (topU: number) => HEAD_H + (rack.heightUnits - topU) * U_PX
  const meterW = SLOT_W / 2 - 8

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
      <text x={RAIL_W} y={16} fontSize={14} fontWeight={700} fill={COLOR.ink}>
        {rack.name}
      </text>
      <Meter
        x={RAIL_W}
        y={34}
        w={meterW}
        used={rack.usedU}
        max={rack.heightUnits}
        label={`${rack.usedU} of ${rack.heightUnits} U${overflowU > 0 ? `, ${overflowU} over` : ''}`}
      />
      <Meter
        x={RAIL_W + SLOT_W / 2 + 8}
        y={34}
        w={meterW}
        used={rack.powerWatts}
        max={rack.maxPowerWatts}
        label={`~${formatPower(rack.powerWatts)} of ${formatPower(rack.maxPowerWatts)}`}
      />

      {/* U scale: a tick per unit, a number every 5 plus the top unit. */}
      {Array.from({ length: rack.heightUnits }, (_, i) => {
        const u = rack.heightUnits - i
        const y = HEAD_H + i * U_PX
        const numbered = u % 5 === 0 || u === rack.heightUnits || u === 1
        return (
          <g key={u}>
            <line x1={RAIL_W - 4} y1={y} x2={RAIL_W} y2={y} stroke={COLOR.gray300} />
            {numbered && (
              <text
                x={RAIL_W - 7}
                y={y + U_PX / 2 + 3.5}
                textAnchor="end"
                fontSize={9.5}
                fill={COLOR.gray400}
              >
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
        fill={COLOR.gray50}
        stroke={COLOR.gray400}
      />
      {Array.from({ length: rack.heightUnits - 1 }, (_, i) => (
        <line
          key={i}
          x1={RAIL_W}
          y1={HEAD_H + (i + 1) * U_PX}
          x2={RAIL_W + SLOT_W}
          y2={HEAD_H + (i + 1) * U_PX}
          stroke={COLOR.gray100}
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
              fill={overflowing ? COLOR.dangerTint : style.fill}
              stroke={overflowing ? COLOR.danger : style.stroke}
              strokeWidth={1}
            />
            <title>{`${slot.label}: ${slot.sublabel ?? ''} (${uRange}, ${slot.units}U)`}</title>
            {slot.units === 1 ? (
              <>
                <text
                  x={RAIL_W + 8}
                  y={centerY + 3.5}
                  fontSize={10.5}
                  fontWeight={600}
                  fill={style.text}
                >
                  {slot.label}
                </text>
                <text
                  x={RAIL_W + SLOT_W - 8}
                  y={centerY + 3.5}
                  textAnchor="end"
                  fontSize={10}
                  fill={COLOR.gray500}
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
                      x={RAIL_W + 9}
                      y={centerY - 7}
                      width={14}
                      height={14}
                      color={COLOR.gray500}
                      aria-hidden="true"
                    />
                  )
                })()}
                <text
                  x={RAIL_W + SLOT_W / 2}
                  y={centerY - 2}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={600}
                  fill={style.text}
                >
                  {slot.label}
                </text>
                <text
                  x={RAIL_W + SLOT_W / 2}
                  y={centerY + 12}
                  textAnchor="middle"
                  fontSize={10.5}
                  fill={COLOR.gray500}
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
                    className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:underline"
                  >
                    <Icon icon={SECTION_ICON.rackGroup} className="h-3.5 w-3.5 text-gray-500" />
                    {run.group.name}
                    <span className="font-normal text-gray-500">
                      · leaf pair and mgmt leaf in {run.racks[1]?.name}
                    </span>
                  </button>
                  <div className="flex gap-3">
                    {run.racks.map((rack) => (
                      <Rack
                        key={rack.id}
                        rack={rack}
                        onClick={() => goTo(partition.partitionId, rack.rackId)}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                run.racks.map((rack) => (
                  <Rack
                    key={rack.id}
                    rack={rack}
                    onClick={() => goTo(partition.partitionId, rack.rackId)}
                  />
                ))
              ),
            )}
            <p className="w-full text-sm text-gray-600">
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
          <span className="h-3 w-3 rounded-sm border border-brand bg-brand-tint" />
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
