import { useState } from 'react'
import { deriveTopology, filterTopology, type TopologyMode } from '../derive/topology'
import { usePlanStore } from '../store/planStore'
import { EXTERNAL_NETWORK_ICON, Icon, NODE_ICON, type LucideIcon } from './icons'

import { navigateTo } from './plan/navigate'
import ZoomPane from './topology/ZoomPane'
import Diagram from './topology/Diagram'
import { COLOR } from './colors'

const LEGEND_DEVICES: [LucideIcon, string][] = [
  [NODE_ICON.leaf, 'Switch'],
  [NODE_ICON.router, 'Router'],
  [NODE_ICON['server-group'], 'Servers'],
  [NODE_ICON['mgmt-server'], 'Mgmt server'],
  [EXTERNAL_NETWORK_ICON.internet, 'Internet'],
]

function LegendLine(props: { color: string; width: number; dashed?: boolean; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <svg width={28} height={8}>
        <line
          x1={0}
          y1={4}
          x2={28}
          y2={4}
          stroke={props.color}
          strokeWidth={props.width}
          strokeDasharray={props.dashed ? '5 4' : undefined}
        />
      </svg>
      {props.label}
    </span>
  )
}

const modes: { mode: TopologyMode; label: string; hint: string }[] = [
  { mode: 'production', label: 'Production', hint: 'Routers, exits, spines, leaves and servers' },
  { mode: 'management', label: 'Management', hint: 'Mgmt spines, mgmt servers, mgmt leaves' },
  { mode: 'central', label: 'Central rack', hint: 'Only the central rack, both networks' },
]

export default function TopologyView() {
  const plan = usePlanStore((s) => s.plan)
  const [mode, setMode] = useState<TopologyMode>('production')
  const graph = filterTopology(deriveTopology(plan), mode)

  const hasContent = graph.partitions.some(
    (p) => p.racks.length > 0 || p.central.spines.length > 0 || p.central.exits.length > 0,
  )

  if (!hasContent) {
    return (
      <p className="text-sm text-gray-600">
        Nothing to draw yet. Add spines and racks in the Plan tab.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Topology view"
          className="inline-flex rounded-md border border-gray-300 bg-white p-0.5"
        >
          {modes.map((m) => (
            <button
              key={m.mode}
              type="button"
              onClick={() => setMode(m.mode)}
              title={m.hint}
              aria-pressed={mode === m.mode}
              className={`rounded px-3 py-1 text-sm font-medium ${
                mode === m.mode
                  ? 'bg-ink text-white'
                  : 'text-gray-600 hover:bg-brand-tint hover:text-ink'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="text-sm text-gray-600">{modes.find((m) => m.mode === mode)?.hint}</span>
      </div>
      <ZoomPane
        footer={
          <>
            {mode !== 'management' && (
              <LegendLine color={COLOR.production} width={2.2} label="Production 100G" />
            )}
            {mode !== 'production' && (
              <LegendLine color={COLOR.mgmt} width={1} label="Management 1G" />
            )}
            {mode !== 'management' && (
              <LegendLine color={COLOR.gray500} width={1.4} dashed label="External network" />
            )}
            <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
              {LEGEND_DEVICES.map(([icon, label]) => (
                <span key={label} className="flex items-center gap-1.5">
                  <Icon icon={icon} className="h-3.5 w-3.5 text-gray-500" />
                  {label}
                </span>
              ))}
            </span>
          </>
        }
      >
        <Diagram graph={graph} onNavigate={navigateTo} />
      </ZoomPane>
    </div>
  )
}
