import { formatCidr, formatCount, size } from '../../derive/ip/cidr'
import type { IpPlanResult } from '../../derive/ip/ipPlan'
import type { IpInfra } from '../../model/ipPlan'
import { usePlanStore } from '../../store/planStore'
import InfoBubble from '../plan/InfoBubble'
import { NumberField } from '../plan/fields'
import { ipFieldAnchor } from '../plan/navigate'
import { IP_INFO } from './infos'
import { CidrInput, PrefixInput } from './inputs'
import RangeBar from './RangeBar'
import { Icon, SECTION_ICON } from '../icons'

/** Infrastructure ranges (IPv4) per partition, sized from the plan's
 *  switches, servers and racks. */
export default function InfraCard({ infra, result }: { infra: IpInfra; result: IpPlanResult }) {
  const patch = usePlanStore((s) => s.patchIpInfra)
  const base = result.infra.parsed.ok ? result.infra.parsed.cidr : null

  return (
    <section className="card p-4">
      <h3 className="text-sm font-semibold">
        <Icon
          icon={SECTION_ICON.infrastructure}
          className="mr-1.5 inline h-4 w-4 align-[-3px] text-gray-500"
        />
        Infrastructure <span className="font-normal text-gray-500">· IPv4, per partition</span>
        <InfoBubble label="infrastructure ranges" info={IP_INFO.infra} />
      </h3>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        <label className="col-span-2 block text-sm md:col-span-1">
          <span className="mb-1 block text-gray-600">Infrastructure CIDR</span>
          <CidrInput
            id={ipFieldAnchor('infra.cidr')}
            value={infra.cidr}
            family={4}
            onChange={(cidr) => patch({ cidr })}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-gray-600">Block per partition</span>
          <PrefixInput
            id={ipFieldAnchor('infra.partitionPrefix')}
            value={infra.partitionPrefix}
            max={32}
            onChange={(partitionPrefix) => patch({ partitionPrefix })}
          />
        </label>
        <NumberField
          label="Headroom (%)"
          info={IP_INFO.headroom}
          value={infra.headroomPercent}
          max={1000}
          onChange={(headroomPercent) => patch({ headroomPercent })}
        />
        <NumberField
          label="Firewalls per partition"
          info={IP_INFO.firewalls}
          value={infra.firewallsPerPartition}
          onChange={(firewallsPerPartition) => patch({ firewallsPerPartition })}
        />
        <label className="block text-sm">
          <span className="mb-1 block text-gray-600">
            Transfer network
            <InfoBubble label="transfer networks" info={IP_INFO.transfer} />
          </span>
          <PrefixInput
            id={ipFieldAnchor('infra.transferPrefix')}
            value={infra.transferPrefix}
            max={32}
            onChange={(transferPrefix) => patch({ transferPrefix })}
          />
        </label>
      </div>

      {base && (
        <div className="mt-4">
          <RangeBar
            domain={base}
            caption={`Infrastructure CIDR ${formatCidr(base)}: ${
              result.infra.blocks === null ? '?' : formatCount(result.infra.blocks)
            } blocks of /${infra.partitionPrefix}`}
            segments={result.infra.partitions.flatMap((p) =>
              p.block
                ? [
                    { cidr: p.block, label: 'Partition blocks', color: '#fcd094' },
                    ...p.subnets
                      .filter((s) => s.cidr)
                      .map((s) => ({ cidr: s.cidr!, label: 'Used', color: '#d97706' })),
                  ]
                : [],
            )}
          />
        </div>
      )}

      {result.infra.partitions.map((p) => (
        <div key={p.partitionId} className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-sm font-semibold text-gray-700">
              {p.partitionName}{' '}
              <span className="font-mono text-xs font-normal text-gray-500">
                {p.block ? formatCidr(p.block) : 'no block'}
              </span>
            </h4>
            <span className={`text-xs ${p.overflow ? 'text-red-700' : 'text-gray-500'}`}>
              {p.block
                ? `${formatCount(p.usedAddresses)} of ${formatCount(size(p.block))} addresses, needs a /${p.requiredPrefix}`
                : `needs a /${p.requiredPrefix}`}
            </span>
          </div>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="py-1 pr-3 font-semibold">Purpose</th>
                  <th className="py-1 pr-3 font-semibold">Scope</th>
                  <th className="py-1 pr-3 text-right font-semibold">Needed</th>
                  <th className="py-1 pr-3 text-right font-semibold">Sized for</th>
                  <th className="py-1 pr-3 font-semibold">CIDR</th>
                  <th className="py-1 font-semibold">Derived from</th>
                </tr>
              </thead>
              <tbody>
                {p.subnets.map((s) => (
                  <tr
                    key={`${s.purpose}|${s.scope}`}
                    className="border-t border-gray-100 align-top"
                  >
                    <td className="py-1 pr-3">
                      {s.purpose}
                      {s.purpose === 'Management' && s.scope !== 'Central rack' && (
                        <InfoBubble label="BMC addresses" info={IP_INFO.bmc} />
                      )}
                    </td>
                    <td className="py-1 pr-3 text-gray-600">{s.scope}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{s.needed}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{s.sized}</td>
                    <td className="py-1 pr-3 font-mono text-xs">
                      {s.cidr ? (
                        formatCidr(s.cidr)
                      ) : (
                        <span className="text-red-700">/{s.prefix} does not fit</span>
                      )}
                    </td>
                    <td className="py-1 text-xs text-gray-500">{s.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  )
}
