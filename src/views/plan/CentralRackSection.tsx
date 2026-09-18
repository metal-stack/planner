import {
  itemLabel,
  nosOptions,
  serversForUsage,
  switchesForRole,
  type SwitchRole,
} from '../../model/catalog'
import type { FabricConfig, MgmtNetwork, Partition } from '../../model/plan'
import { formatTally, partitionNodes } from '../../derive/nodes'
import { formatGbps, formatRatio, spineBandwidth } from '../../derive/bandwidth'
import { issuesFor, type Issue } from '../../derive/validate'
import HoverHint from '../HoverHint'
import { usePlanStore } from '../../store/planStore'
import { DOCS } from './docs'
import { NumberField, SelectField } from './fields'
import InfoBubble from './InfoBubble'
import IssueBadges from './IssueBadges'
import { fabricAnchor } from './navigate'
import { Icon, SECTION_ICON } from '../icons'
import { nosOptionLabel, optionLabel } from './options'

function switchOptions(role: SwitchRole) {
  return switchesForRole(role).map((i) => ({
    value: i.id,
    label: optionLabel(i),
  }))
}

/** The central rack's models while their pickers are folded away:
 *  production switches once each, then the management gear. */
function modelSummary(fabric: FabricConfig): string {
  const production = [
    fabric.spineModelId,
    ...(fabric.fabricType === 'leaf-spine-superspine' ? [fabric.superspineModelId] : []),
    ...(fabric.storageLeafCount > 0 ? [fabric.storageLeafModelId] : []),
  ]
  const mgmtSwitches = [fabric.mgmt.spineModelId, fabric.mgmt.leafModelId]
  return [
    [...new Set(production)].map(itemLabel).join(', '),
    `mgmt ${[...new Set(mgmtSwitches)].map(itemLabel).join(', ')}`,
    `mgmt servers ${itemLabel(fabric.mgmt.serverModelId)}`,
  ].join(' · ')
}

export default function CentralRackSection({
  partition,
  issues,
}: {
  partition: Partition
  issues: Issue[]
}) {
  const own = issuesFor(issues, { partitionId: partition.id })
  const hasErrors = own.some((i) => i.severity === 'error')
  const advancedIssues = own.filter((i) => i.target.field === 'advanced')
  const patchFabric = usePlanStore((s) => s.patchFabric)
  const patchRackDefaults = usePlanStore((s) => s.patchRackDefaults)
  const { fabric } = partition
  const patch = (p: Parameters<typeof patchFabric>[1]) => patchFabric(partition.id, p)
  const patchMgmt = (p: Partial<MgmtNetwork>) => patch({ mgmt: { ...fabric.mgmt, ...p } })
  const hasSuperspine = fabric.fabricType === 'leaf-spine-superspine'
  const spineTier = spineBandwidth(partition)

  return (
    <section
      id={fabricAnchor(partition.id)}
      className={`scroll-mt-6 rounded-lg border bg-white p-4 ${
        hasErrors ? 'border-red-300' : 'border-gray-200'
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Icon icon={SECTION_ICON.centralRack} className="h-4 w-4 text-gray-500" />
          Central rack — {partition.name}
          <InfoBubble
            label="the central rack"
            info={{
              text: 'Each partition has one central rack holding the core of its switch plane — internet routers, exit switches, spines (and superspines) — together with the management spines and the management servers. The compute racks with their leaf switches hang below it.',
              href: DOCS.networking,
            }}
          />
        </h3>
        <span className="flex items-center gap-1.5">
          {spineTier?.ratio != null && (
            <HoverHint
              hint={`Spine tier: ${formatGbps(spineTier.downGbps)} from the leaves against ${formatGbps(spineTier.upGbps)} towards the superspines.`}
            >
              <span
                className={`rounded px-2 py-1 text-xs font-medium ${
                  spineTier.ratio <= 1
                    ? 'bg-emerald-100 text-emerald-800'
                    : fabric.nonBlocking
                      ? 'bg-red-100 text-red-800'
                      : 'bg-amber-100 text-amber-800'
                }`}
              >
                Spine tier {formatRatio(spineTier.ratio)}
              </span>
            </HoverHint>
          )}
          <IssueBadges issues={own} />
          <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
            {formatTally(partitionNodes(partition))}
          </span>
        </span>
      </div>
      <p className="-mt-2 mb-3 text-xs text-gray-500">{modelSummary(fabric)}</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SelectField
          label="Fabric type"
          info={{
            text: 'metal-stack builds a partition as a leaf-spine CLOS fabric: every leaf connects to every spine over layer-3 links (BGP unnumbered, EVPN/VXLAN). Add a superspine tier only when the spines cannot take all leaf uplinks.',
            href: DOCS.networking,
          }}
          value={fabric.fabricType}
          options={[
            { value: 'leaf-spine', label: 'Leaf-spine' },
            { value: 'leaf-spine-superspine', label: 'Leaf-spine-superspine' },
          ]}
          onChange={(v) =>
            patch({
              fabricType: v as Partition['fabric']['fabricType'],
              // sensible default when enabling the extra tier
              superspineCount:
                v === 'leaf-spine-superspine' && fabric.superspineCount === 0
                  ? 2
                  : fabric.superspineCount,
            })
          }
        />
        <NumberField
          label="Spines"
          info={{
            text: 'Every leaf uplinks to every spine, so two spines give redundancy and more spines add fabric bandwidth — at the cost of one leaf port per spine and link.',
            href: DOCS.networking,
          }}
          value={fabric.spineCount}
          onChange={(n) => patch({ spineCount: n })}
        />
        <NumberField
          label="Exit switches"
          info={{
            text: 'Exit switches connect the fabric to the outside world: they peer with the internet routers (numbered BGP) and carry the external networks. They are also the DHCP gateway that gives management servers internet access.',
            href: DOCS.networking,
          }}
          value={fabric.exitSwitchCount}
          onChange={(n) => patch({ exitSwitchCount: n })}
        />
        {hasSuperspine && (
          <NumberField
            label="Superspines"
            info={{
              text: 'A third tier above the spines for very large partitions. Each spine connects once to every superspine.',
              href: DOCS.networking,
            }}
            value={fabric.superspineCount}
            onChange={(n) => patch({ superspineCount: n })}
          />
        )}
      </div>

      <h4 className="mt-4 mb-3 text-sm font-semibold text-gray-700">
        <Icon
          icon={SECTION_ICON.mgmtNetwork}
          className="mr-1.5 inline h-4 w-4 align-[-3px] text-amber-600"
        />
        Management network <span className="font-normal text-gray-500">— out-of-band</span>
        <InfoBubble
          label="the management network"
          info={{
            text: 'A separate out-of-band network: every switch connects its management interface to it, every server its BMC/IPMI port, and the management servers provide access to it. metal-stack keeps it apart from the data plane in a management VRF.',
            href: DOCS.networking,
          }}
        />
      </h4>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SelectField
          label="Layer"
          info={{
            text: 'L3 routes between the management leaves over the management spines (BGP, like the production fabric); L2 stretches one switched segment across them. Both stay outside the data plane in the management VRF.',
            href: DOCS.networking,
          }}
          value={fabric.mgmt.layer}
          options={[
            { value: 'l3', label: 'L3 (routed)' },
            { value: 'l2', label: 'L2 (switched)' },
          ]}
          onChange={(v) => patchMgmt({ layer: v as MgmtNetwork['layer'] })}
        />
        <SelectField
          label="Redundancy"
          info={{
            text: 'Redundant means two management spines and two management servers, each management leaf uplinked to both spines. Single halves all of that.',
          }}
          value={fabric.mgmt.redundant ? 'redundant' : 'single'}
          options={[
            { value: 'redundant', label: 'Redundant (2x)' },
            { value: 'single', label: 'Single' },
          ]}
          onChange={(v) => patchMgmt({ redundant: v === 'redundant' })}
        />
      </div>

      <details className="mt-4" data-advanced>
        <summary className="cursor-pointer text-sm font-semibold text-gray-700">
          Advanced{' '}
          <span className="font-normal text-gray-500">
            — devices and models, network OS, fabric links and rack defaults
          </span>
          {advancedIssues.length > 0 && (
            <span className="ml-2 inline-flex align-middle">
              <IssueBadges issues={advancedIssues} />
            </span>
          )}
        </summary>

        <h5 className="mt-3 mb-2 text-xs font-semibold text-gray-500">Devices and models</h5>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <NumberField
            label="Internet routers"
            info={{
              text: 'Routers between the exit switches and the provider uplink (1U servers with dual-port 100G NICs). Each router is linked twice to every exit switch.',
              href: DOCS.networking,
            }}
            value={fabric.routerCount}
            onChange={(n) => patch({ routerCount: n })}
          />
          <SelectField
            label="Spine model"
            value={fabric.spineModelId}
            options={switchOptions('spine')}
            onChange={(v) => patch({ spineModelId: v })}
          />
          {hasSuperspine && (
            <SelectField
              label="Superspine model"
              value={fabric.superspineModelId}
              options={switchOptions('superspine')}
              onChange={(v) => patch({ superspineModelId: v })}
            />
          )}
          <SelectField
            label="Storage leaf model"
            value={fabric.storageLeafModelId}
            options={switchOptions('storage-leaf')}
            onChange={(v) => patch({ storageLeafModelId: v })}
          />
          <NumberField
            label="Storage leaves"
            info={{
              text: 'Leaf switches for dedicated storage systems, attached once to every spine. Leave at 0 when storage servers live in the compute racks.',
              href: DOCS.hardware,
            }}
            value={fabric.storageLeafCount}
            onChange={(n) => patch({ storageLeafCount: n })}
          />
          <SelectField
            label="Mgmt spine model"
            value={fabric.mgmt.spineModelId}
            options={switchOptions('mgmt-spine')}
            onChange={(v) => patchMgmt({ spineModelId: v })}
          />
          <SelectField
            label="Mgmt leaf model"
            info={{
              text: 'One management leaf per compute rack (a rack group shares one in its middle rack). It terminates the BMC/IPMI ports of the server chassis and the management interfaces of the leaves; metal-bmc discovers machines through it.',
              href: DOCS.metalBmc,
            }}
            value={fabric.mgmt.leafModelId}
            options={switchOptions('mgmt-leaf')}
            onChange={(v) => patchMgmt({ leafModelId: v })}
          />
          <NumberField
            label="Mgmt leaves per rack"
            info={{
              text: 'Add a second management leaf when a rack needs more 1G ports than one switch has (chassis BMCs plus one per leaf). Validation reports when this happens.',
            }}
            value={fabric.mgmt.leafPerRack}
            onChange={(n) => patchMgmt({ leafPerRack: n })}
          />
          <SelectField
            label="Mgmt server model"
            info={{
              text: 'Management servers are not part of the allocatable machine pool. They run the partition services of metal-stack: PXE boot (pixiecore), metal-bmc for IPMI access and console, and the entry point into the management network.',
              href: DOCS.architecture,
            }}
            value={fabric.mgmt.serverModelId}
            options={serversForUsage('management').map((i) => ({
              value: i.id,
              label: optionLabel(i),
            }))}
            onChange={(v) => patchMgmt({ serverModelId: v })}
          />
        </div>

        <h5 className="mt-4 mb-2 text-xs font-semibold text-gray-500">Fabric links</h5>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SelectField
            label="Network OS"
            info={{
              text: 'SONiC distribution on this partition’s switches, which decides the support license every switch gets in the BOM. Broadcom’s Enterprise SONiC is the default: it is current, and Edgecore qualifies its switches for it. Edgecore’s own distribution is the one the official metal-stack hardware list verifies, but it is end-of-life at the vendor and closed to new customers.',
              href: DOCS.hardware,
            }}
            value={fabric.nos}
            options={nosOptions.map((option) => ({
              value: option.id,
              label: nosOptionLabel(option),
            }))}
            onChange={(v) => patch({ nos: v as FabricConfig['nos'] })}
          />
          <NumberField
            label="Links per leaf ↔ spine pair"
            info={{
              text: '100G links each leaf runs to each spine. More links add fabric bandwidth and take leaf ports away from servers; the leaf port check accounts for them.',
              href: DOCS.networking,
            }}
            value={fabric.leafSpineLinks}
            min={1}
            onChange={(n) => patch({ leafSpineLinks: n })}
          />
          <label className="col-span-2 flex items-start gap-2 pt-6 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={fabric.nonBlocking}
              onChange={(e) => patch({ nonBlocking: e.target.checked })}
              className="mt-0.5"
            />
            <span className="text-gray-600">
              Require non-blocking fabric (1:1)
              <InfoBubble
                label="a non-blocking fabric"
                info={{
                  text: 'In a leaf-spine CLOS fabric, a rack is non-blocking when its leaf uplinks carry at least as much bandwidth as the attached machines — 8 nodes with 2×25G need 400 Gbit/s of uplinks. Above 1:1 the fabric is oversubscribed, which is a common and deliberate trade-off. Tick this to have the planner report oversubscription as an error, for the racks and, with superspines, for the spine tier.',
                  href: DOCS.networking,
                }}
              />
            </span>
          </label>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Every leaf uplinks to every spine with this many 100G links. Each switch's single
          management interface connects to the management network on its own.
        </p>

        <h5 className="mt-4 mb-2 text-xs font-semibold text-gray-500">Rack defaults</h5>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <NumberField
            label="Default rack height (U)"
            value={partition.rackDefaults.heightUnits}
            min={1}
            onChange={(n) => patchRackDefaults(partition.id, { heightUnits: n })}
          />
          <NumberField
            label="Default max power per rack (kW)"
            info={{
              text: 'Power budget for new racks in this partition. The rack view estimates the draw from typical per-device figures in the catalog and validation flags racks over budget.',
            }}
            value={partition.rackDefaults.maxPowerWatts / 1000}
            min={1}
            onChange={(n) => patchRackDefaults(partition.id, { maxPowerWatts: n * 1000 })}
          />
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Rack defaults apply to racks added to this partition; each rack can override them in its
          own Advanced section. The central rack uses these values directly.
        </p>
      </details>
    </section>
  )
}
