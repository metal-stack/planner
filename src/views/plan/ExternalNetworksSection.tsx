import { ExternalNetworkSchema, type ExternalNetwork, type Plan } from '../../model/plan'
import { usePlanStore } from '../../store/planStore'
import { DOCS } from './docs'
import { SelectField } from './fields'
import InfoBubble from './InfoBubble'
import { ACTION_ICON, Icon, SECTION_ICON } from '../icons'

const kindLabels: Record<ExternalNetwork['kind'], string> = {
  internet: 'Internet',
  company: 'Company network',
  storage: 'Storage network',
  other: 'Other',
}

/** External attachment points (internet, company networks, storage
 *  backends). They attach in one partition, or in every partition when
 *  none is chosen: storage networks at its storage leaves (at its exit
 *  switches when it has none), everything else at its internet routers. */
export default function ExternalNetworksSection({ plan }: { plan: Plan }) {
  const add = usePlanStore((s) => s.addExternalNetwork)
  const patch = usePlanStore((s) => s.patchExternalNetwork)
  const remove = usePlanStore((s) => s.removeExternalNetwork)

  const partitionOptions = [
    { value: '', label: 'All partitions' },
    ...plan.partitions.map((p) => ({ value: p.id, label: p.name })),
  ]

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          <Icon
            icon={SECTION_ICON.externalNetworks}
            className="mr-1.5 inline h-4 w-4 align-[-3px] text-gray-500"
          />
          External networks{' '}
          <span className="font-normal text-gray-500">
            · attach at the routers, exits or storage leaves
          </span>
          <InfoBubble
            label="external networks"
            info={{
              text: 'Networks outside the fabric: the internet uplink, company networks, storage backends. They enter one partition, or every partition when none is chosen. Internet and company networks come in through the internet routers (through the exit switches when the partition has no routers); a storage network attaches to the storage leaves, or to the exit switches when the partition has none.',
              href: DOCS.networking,
            }}
          />
        </h3>
      </div>
      {plan.externalNetworks.length === 0 && (
        <p className="mb-3 text-sm text-gray-500">No external networks.</p>
      )}
      {plan.externalNetworks.map((net) => (
        <div
          key={net.id}
          className="grid grid-cols-2 items-end gap-3 border-t border-gray-100 py-2 md:grid-cols-4"
        >
          <label className="block text-sm">
            <span className="mb-1 block text-gray-600">Name</span>
            <input
              type="text"
              value={net.name}
              onChange={(e) => patch(net.id, { name: e.target.value })}
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5"
            />
          </label>
          <SelectField
            label="Kind"
            value={net.kind}
            options={ExternalNetworkSchema.shape.kind.options.map((k) => ({
              value: k,
              label: kindLabels[k],
            }))}
            onChange={(v) => patch(net.id, { kind: v as ExternalNetwork['kind'] })}
          />
          <SelectField
            label="Attached to"
            value={
              plan.partitions.some((p) => p.id === net.attachedPartitionId)
                ? net.attachedPartitionId
                : ''
            }
            options={partitionOptions}
            onChange={(v) => patch(net.id, { attachedPartitionId: v })}
          />
          <button
            type="button"
            onClick={() => remove(net.id)}
            className="flex items-center gap-1 justify-self-start text-xs text-gray-400 hover:text-red-700 hover:underline"
          >
            <Icon icon={ACTION_ICON.remove} className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => add()} className="btn-secondary mt-3">
        <Icon icon={ACTION_ICON.add} />
        Add external network
      </button>
    </section>
  )
}
