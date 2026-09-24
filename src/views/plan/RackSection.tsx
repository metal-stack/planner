import {
  catalog,
  cpusForServer,
  defaultNicId,
  dimmsForServer,
  gpusForServer,
  itemLabel,
  nicsForUplink,
  serversForUsage,
  switchesForRole,
} from '../../model/catalog'
import { useState } from 'react'
import { chassisPositions, groupConfig, nodeConfig } from '../../model/nodeConfig'
import type { NodeConfig, Partition, Rack, ServerGroup } from '../../model/plan'
import { nodeSizes, resolveNodeCompute } from '../../model/sizes'
import { formatTally, rackNodes } from '../../derive/nodes'
import { formatGbps, formatRatio, rackBandwidth } from '../../derive/bandwidth'
import { issuesFor, leafPortsAvailable, leafPortsNeeded, type Issue } from '../../derive/validate'
import HoverHint from '../HoverHint'
import { usePlanStore } from '../../store/planStore'
import { DOCS } from './docs'
import { NumberField, SelectField } from './fields'
import IssueBadges from './IssueBadges'
import { rackAnchor } from './navigate'
import { ACTION_ICON, Icon, SECTION_ICON } from '../icons'
import { optionLabel } from './options'

/** Node selector chip in the Node configuration menu: `custom` marks a node
 *  carrying its own configuration. */
function NodeButton({
  active,
  custom,
  onClick,
  children,
}: {
  active: boolean
  custom?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-ink bg-ink text-white'
          : custom
            ? 'border-brand-strong bg-white font-semibold text-brand-strong hover:bg-white/60'
            : 'border-gray-300 bg-white text-gray-700 hover:bg-white/60'
      }`}
    >
      {children}
    </button>
  )
}

function ServerGroupRow({
  partition,
  rack,
  group,
}: {
  partition: Partition
  rack: Rack
  group: ServerGroup
}) {
  const patchServerGroup = usePlanStore((s) => s.patchServerGroup)
  const removeServerGroup = usePlanStore((s) => s.removeServerGroup)
  const patch = (p: Partial<ServerGroup>) => patchServerGroup(partition.id, rack.id, group.id, p)

  const nodesPer = catalog[group.modelId]?.nodesPerChassis ?? 1
  // Nodes this group could grow to with the leaf ports the other groups
  // leave free: 25G needs half a 100G port per node (4x25G breakout, 2
  // ports per node), 100G two full ports — rounded down to whole chassis.
  const others = { ...rack, servers: rack.servers.filter((g) => g.id !== group.id) }
  const freePorts = Math.max(0, leafPortsAvailable(rack, partition) - leafPortsNeeded(others))
  const maxNodes = group.uplink === '2x25G' ? freePorts * 2 : Math.floor(freePorts / 2)
  const fillCount = Math.floor(maxNodes / nodesPer) * nodesPer

  const modelOptions = serversForUsage(group.role).map((i) => ({
    value: i.id,
    label: optionLabel(i),
  }))
  // Keep an out-of-role selection visible so the user can see and fix it.
  if (!modelOptions.some((o) => o.value === group.modelId)) {
    modelOptions.push({ value: group.modelId, label: `${group.modelId} (incompatible)` })
  }

  // GPUs are only offered for server models that accept one; the model's
  // gpuCapable caps how many go in each node.
  const gpuOptions = gpusForServer(group.modelId).map((i) => ({
    value: i.id,
    label: optionLabel(i),
  }))

  const socket = catalog[group.modelId]?.socket
  const cpuOptions = cpusForServer(group.modelId)
  const dimmOptions = dimmsForServer(group.modelId)

  // The chassis position whose configuration the fields edit: null = the
  // group's shared configuration; a position applies to that node in every
  // chassis and keeps its own complete copy once edited.
  const positions = chassisPositions(group)
  const [selectedNode, setSelectedNode] = useState<number | null>(null)
  const sel = selectedNode !== null && selectedNode < positions ? selectedNode : null
  const shown: NodeConfig = sel === null ? groupConfig(group) : nodeConfig(group, sel)
  const customPositions = Object.keys(group.nodeConfigs)
    .map(Number)
    .filter((i) => i >= 0 && i < positions)

  const perNode = Math.min(shown.gpu?.perNode ?? 1, catalog[group.modelId]?.gpuCapable ?? 1)
  const resolvedCompute = resolveNodeCompute({ modelId: group.modelId, ...shown })
  // The preset's own parts, for naming what "Preset default" resolves to.
  const presetParts = resolveNodeCompute({ modelId: group.modelId, sizeId: shown.sizeId })
  // The preset stays the baseline; deviating fields mark it "customized".
  const sizeOptions = nodeSizes.map((size) => {
    const note =
      !socket || !size.parts[socket]
        ? ', not for this model'
        : size.id === shown.sizeId && resolvedCompute.custom
          ? ', customized'
          : ''
    return {
      value: size.id,
      label: `${size.id} (${size.cores} cores, ${size.memoryGiB} GiB${note})`,
    }
  })
  const defaultNic = defaultNicId(group.uplink)
  const nicOptions = [
    { value: '', label: `${itemLabel(defaultNic)} (default)` },
    ...nicsForUplink(group.uplink)
      .filter((item) => item.id !== defaultNic)
      .map((item) => ({ value: item.id, label: optionLabel(item) })),
  ]
  // The collapsed summary always describes the group's shared configuration.
  const groupResolved = resolveNodeCompute(group)
  const nodeSummary = [
    groupResolved.cpuModelId ? itemLabel(groupResolved.cpuModelId) : undefined,
    groupResolved.dimmModelId && groupResolved.dimmsPerNode
      ? `${groupResolved.dimmsPerNode}× ${catalog[groupResolved.dimmModelId]?.description ?? groupResolved.dimmModelId}`
      : undefined,
    itemLabel(group.nicModelId ?? defaultNic),
    group.gpu ? itemLabel(group.gpu.modelId) : undefined,
    customPositions.length > 0
      ? `${customPositions.length} chassis position${customPositions.length === 1 ? '' : 's'} customized`
      : undefined,
  ]
    .filter(Boolean)
    .join(', ')

  const patchShown = (change: Partial<NodeConfig>) => {
    if (sel === null) {
      patch(change)
    } else {
      patch({ nodeConfigs: { ...group.nodeConfigs, [sel]: { ...shown, ...change } } })
    }
  }
  const patchCompute = (change: NonNullable<ServerGroup['compute']>) => {
    const next = { ...shown.compute, ...change }
    const compute =
      next.cpuModelId || next.dimmModelId || next.dimmsPerNode
        ? {
            ...(next.cpuModelId && { cpuModelId: next.cpuModelId }),
            ...(next.dimmModelId && { dimmModelId: next.dimmModelId }),
            ...(next.dimmsPerNode && { dimmsPerNode: next.dimmsPerNode }),
          }
        : undefined
    patchShown({ compute })
  }
  // Board- or uplink-specific parts in per-node configurations reset along
  // with the group's when the model or uplink changes.
  const configsWithout = (field: 'compute' | 'nicModelId') =>
    Object.fromEntries(
      Object.entries(group.nodeConfigs).map(([node, config]) => [
        node,
        { ...config, [field]: undefined },
      ]),
    )
  const configureAll = () => {
    patch({
      sizeId: shown.sizeId,
      compute: shown.compute,
      nicModelId: shown.nicModelId,
      gpu: shown.gpu,
      nodeConfigs: {},
    })
    setSelectedNode(null)
  }

  return (
    <div className="mt-3 rounded-md border border-brand-soft bg-brand-tint p-3">
      <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-6">
        <SelectField
          label="Role"
          value={group.role}
          options={[
            { value: 'worker', label: 'Worker' },
            { value: 'storage', label: 'Storage' },
          ]}
          onChange={(v) => {
            const role = v as ServerGroup['role']
            const compatible = serversForUsage(role)
            patch(
              compatible.some((i) => i.id === group.modelId)
                ? { role }
                : {
                    role,
                    modelId: compatible[0]?.id ?? group.modelId,
                    compute: undefined,
                    nodeConfigs: configsWithout('compute'),
                  },
            )
          }}
        />
        <SelectField
          label="Server model"
          info={{
            text: 'Only server models on the metal-stack hardware compatibility list for this role are offered. Multi-node chassis (MicroCloud, BigTwin) count nodes here; the BOM derives the chassis.',
            href: DOCS.hardware,
          }}
          value={group.modelId}
          options={modelOptions}
          onChange={(v) =>
            patch({ modelId: v, compute: undefined, nodeConfigs: configsWithout('compute') })
          }
        />
        <NumberField
          label="Nodes"
          value={group.count}
          step={nodesPer}
          onChange={(n) => patch({ count: n })}
          action={
            <HoverHint
              interactive
              hint={
                fillCount === group.count
                  ? `Already filling the rack's leaf capacity (${fillCount} nodes).`
                  : `Fill to leaf capacity: set ${fillCount} nodes, what the rack's remaining leaf ports allow in whole chassis of ${nodesPer}.`
              }
            >
              <button
                type="button"
                onClick={() => patch({ count: fillCount })}
                disabled={fillCount === group.count}
                aria-label={`Fill to leaf capacity (${fillCount} nodes)`}
                className="text-gray-400 hover:text-brand-strong disabled:cursor-default disabled:text-gray-300"
              >
                <Icon icon={ACTION_ICON.fill} className="h-3.5 w-3.5" />
              </button>
            </HoverHint>
          }
        />
        <SelectField
          label="Uplink"
          info={{
            text: 'Every node is dual-attached to the leaf pair. 25G server ports terminate on 100G leaf ports through 4×25G breakout cables; 100G uses one leaf port per server port. This drives the leaf port check and the transceiver and cable counts.',
            href: DOCS.networking,
          }}
          value={group.uplink}
          options={[
            { value: '2x25G', label: '2x 25G' },
            { value: '2x100G', label: '2x 100G' },
          ]}
          onChange={(v) =>
            patch({
              uplink: v as ServerGroup['uplink'],
              nicModelId: undefined,
              nodeConfigs: configsWithout('nicModelId'),
            })
          }
        />
        <button
          onClick={() => removeServerGroup(partition.id, rack.id, group.id)}
          className="btn-secondary justify-self-start"
        >
          <Icon icon={ACTION_ICON.remove} />
          Remove
        </button>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-semibold text-gray-700">
          Node configuration{' '}
          {nodeSummary && <span className="font-normal text-gray-500">· {nodeSummary}</span>}
        </summary>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <NodeButton active={sel === null} onClick={() => setSelectedNode(null)}>
            All nodes
          </NodeButton>
          {Array.from({ length: positions }, (_, i) => (
            <NodeButton
              key={i}
              active={sel === i}
              custom={customPositions.includes(i)}
              onClick={() => setSelectedNode(i)}
            >
              {i + 1}
            </NodeButton>
          ))}
          <button
            onClick={configureAll}
            disabled={sel === null && customPositions.length === 0}
            className="btn-secondary ml-auto"
          >
            Configure all nodes
          </button>
        </div>
        {sel !== null && group.nodeConfigs[sel] !== undefined && (
          <button
            type="button"
            onClick={() => {
              const rest = { ...group.nodeConfigs }
              delete rest[sel]
              patch({ nodeConfigs: rest })
            }}
            className="mt-2 text-xs text-gray-600 underline hover:text-ink"
          >
            Reset chassis position {sel + 1} to the group configuration
          </button>
        )}
        <div className="mt-3 grid grid-cols-2 items-end gap-3 md:grid-cols-6">
          <SelectField
            label="Preset"
            info={{
              text: 'Presets mirror the metalstack.cloud machine types and resolve to orderable CPU and memory parts for the chosen server model; the BOM lists them per node. Storage groups use the same presets. Changing a field below deviates from the preset; selecting a number above configures that node position in every chassis of the group.',
            }}
            value={shown.sizeId}
            options={sizeOptions}
            onChange={(v) => patchShown({ sizeId: v, compute: undefined })}
          />
          {cpuOptions.length > 0 && (
            <>
              <SelectField
                label="CPU"
                value={shown.compute?.cpuModelId ?? ''}
                options={[
                  {
                    value: '',
                    label: presetParts.cpuModelId
                      ? `${itemLabel(presetParts.cpuModelId)} (preset)`
                      : 'Preset default',
                  },
                  ...cpuOptions.map((item) => ({ value: item.id, label: optionLabel(item) })),
                ]}
                onChange={(v) => patchCompute({ cpuModelId: v || undefined })}
              />
              <SelectField
                label="DIMM model"
                value={shown.compute?.dimmModelId ?? ''}
                options={[
                  {
                    value: '',
                    label: presetParts.dimmModelId
                      ? `${catalog[presetParts.dimmModelId]?.description ?? presetParts.dimmModelId} (preset)`
                      : 'Preset default',
                  },
                  ...dimmOptions.map((item) => ({ value: item.id, label: optionLabel(item) })),
                ]}
                onChange={(v) => patchCompute({ dimmModelId: v || undefined })}
              />
              <NumberField
                label="DIMMs per node"
                value={shown.compute?.dimmsPerNode ?? resolvedCompute.dimmsPerNode ?? 0}
                onChange={(value) =>
                  patchCompute({
                    dimmsPerNode: value && value !== presetParts.dimmsPerNode ? value : undefined,
                  })
                }
              />
            </>
          )}
          <SelectField
            label="NIC"
            info={{
              text: "Dual-port NIC fitted to every node, filtered to the group's uplink speed. All options are on the metal-stack hardware compatibility list; the default is the Intel E810 the reference setups use.",
              href: DOCS.hardware,
            }}
            value={shown.nicModelId ?? ''}
            options={nicOptions}
            onChange={(v) => patchShown({ nicModelId: v || undefined })}
          />
          {gpuOptions.length > 0 && (
            <SelectField
              label="GPU"
              info={{
                text: 'GPUs on the metal-stack hardware compatibility list, offered for server models that accept one. They add to the BOM and to the rack power estimate.',
                href: DOCS.hardware,
              }}
              value={shown.gpu?.modelId ?? ''}
              options={[{ value: '', label: 'None' }, ...gpuOptions]}
              onChange={(v) =>
                patchShown({ gpu: v ? { modelId: v, perNode: perNode } : undefined })
              }
            />
          )}
        </div>
      </details>
    </div>
  )
}

/** Physical racks of a rack group, in `memberNames` order. */
const MEMBER_LABELS = ['Left rack', 'Middle rack (leaves, mgmt leaf)', 'Right rack']

export default function RackSection({
  partition,
  rack,
  issues,
}: {
  partition: Partition
  rack: Rack
  issues: Issue[]
}) {
  const own = issuesFor(issues, { partitionId: partition.id, rackId: rack.id })
  const hasErrors = own.some((i) => i.severity === 'error')
  const advancedIssues = own.filter((i) => i.target.field === 'advanced')
  const patchRack = usePlanStore((s) => s.patchRack)
  const setRackKind = usePlanStore((s) => s.setRackKind)
  const removeRack = usePlanStore((s) => s.removeRack)
  const addServerGroup = usePlanStore((s) => s.addServerGroup)

  const bandwidth = rackBandwidth(rack, partition)
  const needed = leafPortsNeeded(rack)
  const available = leafPortsAvailable(rack, partition)
  const overCapacity = needed > available
  const nodes = rackNodes(rack)

  return (
    <section
      id={rackAnchor(rack.id)}
      className={`relative scroll-mt-6 rounded-lg border bg-white p-4 ${
        hasErrors ? 'border-red-300' : 'border-gray-200'
      }`}
    >
      <button
        type="button"
        onClick={() => removeRack(partition.id, rack.id)}
        title="Remove this rack (undoable)"
        className="absolute top-2 right-3 flex items-center gap-1 text-xs text-gray-400 hover:text-red-700 hover:underline"
      >
        <Icon icon={ACTION_ICON.remove} className="h-3.5 w-3.5" />
        Remove rack
      </button>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Icon
          icon={rack.kind === 'rack-group' ? SECTION_ICON.rackGroup : SECTION_ICON.rack}
          className="mb-2.5 h-5 w-5 text-gray-400"
        />
        <label className="block text-sm">
          <span className="mb-1 block text-gray-600">
            {rack.kind === 'rack-group' ? 'Group name' : 'Rack name'}
          </span>
          <input
            type="text"
            value={rack.name}
            onChange={(e) => patchRack(partition.id, rack.id, { name: e.target.value })}
            className="rounded-md border border-gray-300 bg-white px-2 py-1.5"
          />
        </label>
        <div className="w-52">
          <SelectField
            label="Rack type"
            info={{
              text: 'A rack group is one entity of three physical racks that share the leaf pair and the management leaf of the middle rack; server chassis are spread evenly across the three. See the rack spreading proposal.',
              href: DOCS.rackSpreading,
              linkLabel: 'MEP-12',
            }}
            value={rack.kind}
            options={[
              { value: 'single', label: 'Single rack' },
              { value: 'rack-group', label: 'Rack group (3 racks)' },
            ]}
            onChange={(v) => setRackKind(partition.id, rack.id, v as Rack['kind'])}
          />
        </div>
        {rack.memberNames && (
          <span className="mb-2 text-xs text-gray-500">{rack.memberNames.join(' · ')}</span>
        )}
        {/* Tallies on the right, as in the central rack: leaf ports, fabric
            ratio, issues and node count. */}
        <span className="mb-1 ml-auto flex flex-wrap items-center justify-end gap-1.5">
          <HoverHint
            hint={`${needed} of ${Math.max(available, 0)} leaf ports used: ${rack.leafCount}x ${itemLabel(rack.leafModelId)} after the spine uplinks, 25G servers on 4x25G breakout.`}
          >
            <span
              className={`rounded px-2 py-1 text-xs font-medium ${
                overCapacity ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'
              }`}
            >
              Leaf ports {needed} / {Math.max(available, 0)}
            </span>
          </HoverHint>
          {bandwidth.ratio !== null && (
            <HoverHint
              hint={`${formatGbps(bandwidth.downGbps)} of server bandwidth against ${formatGbps(bandwidth.upGbps)} of leaf uplinks (${rack.leafCount} leaves × ${partition.fabric.spineCount} spines × ${partition.fabric.leafSpineLinks} link${partition.fabric.leafSpineLinks === 1 ? '' : 's'} × 100 Gbit/s).`}
            >
              <span
                className={`rounded px-2 py-1 text-xs font-medium ${
                  bandwidth.ratio <= 1
                    ? 'bg-emerald-100 text-emerald-800'
                    : partition.fabric.nonBlocking
                      ? 'bg-red-100 text-red-800'
                      : 'bg-amber-100 text-amber-800'
                }`}
              >
                Fabric {formatRatio(bandwidth.ratio)}
              </span>
            </HoverHint>
          )}
          <IssueBadges issues={own} />
          <HoverHint hint={formatTally(nodes)}>
            <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
              {nodes.total} {nodes.total === 1 ? 'node' : 'nodes'}
            </span>
          </HoverHint>
        </span>
      </div>

      {rack.servers.map((group) => (
        <ServerGroupRow key={group.id} partition={partition} rack={rack} group={group} />
      ))}
      <button onClick={() => addServerGroup(partition.id, rack.id)} className="btn-secondary mt-3">
        <Icon icon={ACTION_ICON.add} />
        Add server group
      </button>
      <details className="mt-3" data-advanced>
        <summary className="cursor-pointer text-sm font-semibold text-gray-700">
          Advanced{' '}
          <span className="font-normal text-gray-500">
            · {rack.memberNames ? 'rack names, ' : ''}leaves, height and power budget
          </span>
          {advancedIssues.length > 0 && (
            <span className="ml-2 inline-flex align-middle">
              <IssueBadges issues={advancedIssues} />
            </span>
          )}
        </summary>
        <div className="mt-3 space-y-3">
          {rack.memberNames && (
            <div className="flex flex-wrap items-end gap-3">
              {MEMBER_LABELS.map((label, i) => (
                <label key={label} className="block text-sm">
                  <span className="mb-1 block text-gray-600">{label}</span>
                  <input
                    type="text"
                    value={rack.memberNames![i]}
                    onChange={(e) => {
                      const memberNames = [...rack.memberNames!] as [string, string, string]
                      memberNames[i] = e.target.value
                      patchRack(partition.id, rack.id, { memberNames })
                    }}
                    className="w-40 rounded-md border border-gray-300 bg-white px-2 py-1.5"
                  />
                </label>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-44">
              <SelectField
                label="Leaf model"
                info={{
                  text: 'Leaf switches run metal-core, which configures them from the metal-api, so they must be on the metal-stack hardware compatibility list. Only compatible models are offered.',
                  href: DOCS.hardware,
                }}
                value={rack.leafModelId}
                options={switchesForRole('leaf').map((i) => ({
                  value: i.id,
                  label: optionLabel(i),
                }))}
                onChange={(v) => patchRack(partition.id, rack.id, { leafModelId: v })}
              />
            </div>
            <div className="w-24">
              <NumberField
                label="Leaves"
                info={{
                  text: 'Bare-metal servers are dual-attached, so a rack normally has a pair of leaves. Each leaf uplinks to every spine.',
                  href: DOCS.networking,
                }}
                value={rack.leafCount}
                onChange={(n) => patchRack(partition.id, rack.id, { leafCount: n })}
              />
            </div>
            <div className="w-28">
              <NumberField
                label="Height (U)"
                value={rack.heightUnits}
                min={1}
                onChange={(n) => patchRack(partition.id, rack.id, { heightUnits: n })}
              />
            </div>
            <div className="w-44">
              <NumberField
                label="Max power draw (kW)"
                info={{
                  text: 'Power budget of this physical rack (each rack of a rack group). The estimate sums typical per-device draw from the catalog; validation reports racks over budget.',
                }}
                value={rack.maxPowerWatts / 1000}
                min={1}
                onChange={(n) => patchRack(partition.id, rack.id, { maxPowerWatts: n * 1000 })}
              />
            </div>
          </div>
        </div>
      </details>
    </section>
  )
}
