import { itemLabel, serversForUsage, switchesForRole } from '../../model/catalog'
import type { ControlPlane, Plan } from '../../model/plan'
import { controlPlaneFootprint } from '../../derive/controlPlane'
import { formatPower } from '../../derive/rackLayout'
import type { Issue } from '../../derive/validate'
import { usePlanStore } from '../../store/planStore'
import { DOCS } from './docs'
import { NumberField, SelectField } from './fields'
import InfoBubble from './InfoBubble'
import IssueBadges from './IssueBadges'
import { CONTROL_PLANE_ANCHOR } from './navigate'
import { Icon, SECTION_ICON } from '../icons'
import { optionLabel } from './options'

/** Where the metal-stack control plane runs. The deployment guide leaves
 *  the location open and asks only that the partitions can reach it, so
 *  this section is a hosting choice first: a managed Kubernetes service
 *  orders nothing, on-prem nodes are hardware in a rack. */
export default function ControlPlaneSection({ plan, issues }: { plan: Plan; issues: Issue[] }) {
  const patch = usePlanStore((s) => s.patchControlPlane)
  const patchRack = usePlanStore((s) => s.patchControlPlaneRack)
  const cp = plan.controlPlane
  const own = issues.filter((i) => i.target.section === 'control-plane')
  const hasErrors = own.some((i) => i.severity === 'error')
  const onPrem = cp.hosting === 'on-prem'
  const ownRack = onPrem && cp.placement === 'own-rack'
  const footprint = controlPlaneFootprint(cp)

  const summary = onPrem
    ? `${cp.nodeCount} × ${itemLabel(cp.nodeModelId)} · ${footprint.units} U, ${formatPower(footprint.watts)}`
    : cp.name

  return (
    <section
      id={CONTROL_PLANE_ANCHOR}
      className={`scroll-mt-6 rounded-lg border bg-white p-4 ${
        hasErrors ? 'border-red-300' : 'border-gray-200'
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Icon icon={SECTION_ICON.controlPlane} className="h-4 w-4 text-gray-500" />
          Control plane
          <InfoBubble
            label="the control plane"
            info={{
              text: 'The metal-stack control plane is a Kubernetes cluster running metal-api, masterdata-api, the IPAM and their databases. It does not matter where that cluster lives: a managed Kubernetes service is fine, and so are dedicated nodes of your own. The one requirement is that every partition can establish network connections to it.',
              href: DOCS.deploymentGuide,
            }}
          />
        </h3>
        <span className="flex items-center gap-1.5">
          <IssueBadges issues={own} />
          <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
            {summary}
          </span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SelectField
          label="Hosting"
          info={{
            text: 'Managed Kubernetes (KaaS) puts the control plane on someone else’s cluster: nothing to rack, nothing to order, and it keeps the control plane out of the partition it controls. On-prem means this plan buys the nodes it runs on.',
            href: DOCS.deploymentGuide,
          }}
          value={cp.hosting}
          options={[
            { value: 'kaas', label: 'Managed Kubernetes (KaaS)' },
            { value: 'on-prem', label: 'On-prem nodes' },
          ]}
          onChange={(v) => patch({ hosting: v as ControlPlane['hosting'] })}
        />
        {!onPrem && (
          <label className="block text-sm">
            <span className="mb-1 block text-gray-600">Cluster name</span>
            <input
              type="text"
              value={cp.name}
              onChange={(e) => patch({ name: e.target.value })}
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5"
            />
          </label>
        )}
        {onPrem && (
          <>
            <SelectField
              label="Site"
              info={{
                text: 'The partition whose site the nodes stand in. The control plane still serves every partition of the plan; hosting it at one site means that site going down takes it with it.',
              }}
              value={plan.partitions.some((p) => p.id === cp.partitionId) ? cp.partitionId : ''}
              options={[
                { value: '', label: plan.partitions[0]?.name ?? 'First partition' },
                ...plan.partitions.map((p) => ({ value: p.id, label: p.name })),
              ]}
              onChange={(v) => patch({ partitionId: v })}
            />
            <SelectField
              label="Placement"
              info={{
                text: 'In the central rack the nodes stand next to the management servers and attach to the exit switches. A rack of their own gets its own leaf pair, uplinked to the spines like a compute rack.',
              }}
              value={cp.placement}
              options={[
                { value: 'central-rack', label: 'In the central rack' },
                { value: 'own-rack', label: 'Own rack' },
              ]}
              onChange={(v) => patch({ placement: v as ControlPlane['placement'] })}
            />
            <SelectField
              label="Node model"
              info={{
                text: 'These nodes run the Kubernetes cluster, so metal-stack never provisions them: the hardware compatibility list does not apply and any 1U server will do. The management server models are offered because they are the same class of machine.',
                href: DOCS.deploymentGuide,
              }}
              value={cp.nodeModelId}
              options={serversForUsage('management').map((i) => ({
                value: i.id,
                label: optionLabel(i),
              }))}
              onChange={(v) => patch({ nodeModelId: v })}
            />
            <NumberField
              label="Nodes"
              info={{
                text: 'Nodes of the Kubernetes cluster. Three is the smallest cluster that keeps etcd quorum when one node is lost.',
              }}
              value={cp.nodeCount}
              onChange={(n) => patch({ nodeCount: n })}
            />
            <SelectField
              label="Uplink"
              info={{
                text: 'Every node is dual-attached, like a machine in a compute rack: 25G ports terminate on a 100G switch port through 4x25G breakout, 100G ports one to one.',
              }}
              value={cp.uplink}
              options={[
                { value: '2x25G', label: '2x 25G' },
                { value: '2x100G', label: '2x 100G' },
              ]}
              onChange={(v) => patch({ uplink: v as ControlPlane['uplink'] })}
            />
          </>
        )}
      </div>

      {ownRack && (
        <details data-advanced className="mt-3 border-t border-gray-100 pt-3">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">
            Advanced <span className="font-normal text-gray-500">· the control plane rack</span>
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <label className="block text-sm">
              <span className="mb-1 block text-gray-600">Rack name</span>
              <input
                type="text"
                value={cp.rack.name}
                onChange={(e) => patchRack({ name: e.target.value })}
                className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5"
              />
            </label>
            <SelectField
              label="Leaf model"
              value={cp.rack.leafModelId}
              options={switchesForRole('leaf').map((i) => ({ value: i.id, label: optionLabel(i) }))}
              onChange={(v) => patchRack({ leafModelId: v })}
            />
            <NumberField
              label="Leaves"
              info={{
                text: 'The nodes are dual-attached, so this rack normally has a leaf pair. Each leaf uplinks to every spine and counts against the spine port budget.',
              }}
              value={cp.rack.leafCount}
              onChange={(n) => patchRack({ leafCount: n })}
            />
            <NumberField
              label="Height (U)"
              value={cp.rack.heightUnits}
              onChange={(n) => patchRack({ heightUnits: n })}
            />
            <NumberField
              label="Max power draw (kW)"
              value={cp.rack.maxPowerWatts / 1000}
              step={0.5}
              onChange={(kw) => patchRack({ maxPowerWatts: Math.round(kw * 1000) })}
            />
          </div>
        </details>
      )}
    </section>
  )
}
