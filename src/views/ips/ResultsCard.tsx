import { formatCount } from '../../derive/ip/cidr'
import HoverHint from '../HoverHint'
import {
  largestCluster,
  METRIC_LABEL,
  type FamilyResult,
  type IpPlanResult,
  type MetricId,
} from '../../derive/ip/ipPlan'
import { Icon, SECTION_ICON } from '../icons'

const GROUPS: { title: string; ids: MetricId[] }[] = [
  { title: 'Internet', ids: ['publicAddresses', 'maxTenants'] },
  {
    title: 'Project networks',
    ids: [
      'partitionSlots',
      'usableSlots',
      'projectNetworksPerPartition',
      'projectNetworksPlan',
      'addressesPerProjectNetwork',
    ],
  },
  {
    title: 'Kubernetes',
    ids: [
      'maxShootWorkers',
      'maxSeedWorkers',
      'podIpsPerWorker',
      'maxPods',
      'shootServices',
      'seedServices',
    ],
  },
]

/** The value; the formula it came from (or why it is missing) on hover. */
function Value({ f, id }: { f: FamilyResult; id: MetricId }) {
  const m = f.metrics[id]
  if (m.value === null) {
    return (
      <HoverHint hint={m.formula}>
        <span className="text-gray-400">—</span>
      </HoverHint>
    )
  }
  return (
    <HoverHint hint={m.formula}>
      <span className="font-medium tabular-nums">{formatCount(m.value)}</span>
    </HoverHint>
  )
}

/** Derived limits per family, each with the formula it came from. */
export default function ResultsCard({ result }: { result: IpPlanResult }) {
  const families = [result.ipv4, ...(result.ipv6.enabled ? [result.ipv6] : [])]
  return (
    <section className="card overflow-hidden">
      <header className="border-b border-gray-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold">
          <Icon
            icon={SECTION_ICON.limits}
            className="mr-1.5 inline h-4 w-4 align-[-3px] text-gray-500"
          />
          Limits <span className="font-normal text-gray-500">— hover a value for its formula</span>
        </h3>
      </header>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500">
            <th className="px-3 py-1.5 font-semibold">Output</th>
            {families.map((f) => (
              <th key={f.key} className="px-3 py-1.5 font-semibold">
                {f.key === 'ipv4' ? 'IPv4' : 'IPv6'}
              </th>
            ))}
          </tr>
        </thead>
        {GROUPS.map((group) => (
          <tbody key={group.title}>
            <tr className="border-y border-gray-200 bg-gray-50">
              <th
                colSpan={families.length + 1}
                className="px-3 py-1 text-left text-xs font-semibold text-gray-600 uppercase"
              >
                {group.title}
              </th>
            </tr>
            {group.ids.map((id) => (
              <tr key={id} className="border-b border-gray-100 align-top">
                <td className="px-3 py-1.5 text-gray-600">{METRIC_LABEL[id]}</td>
                {families.map((f) => (
                  <td key={f.key} className="px-3 py-1.5">
                    <Value f={f} id={id} />
                  </td>
                ))}
              </tr>
            ))}
            {group.title === 'Kubernetes' && (
              <tr className="align-top">
                <td className="px-3 py-1.5 text-gray-600">Largest single cluster</td>
                {families.map((f) => {
                  const l = largestCluster(f)
                  return (
                    <td key={f.key} className="px-3 py-1.5">
                      {l ? (
                        <HoverHint hint={`Limited by the ${l.limitedBy}`}>
                          <span className="font-medium tabular-nums">
                            {formatCount(l.value)} workers
                          </span>
                        </HoverHint>
                      ) : (
                        <HoverHint hint="needs valid inputs">
                          <span className="text-gray-400">—</span>
                        </HoverHint>
                      )}
                    </td>
                  )
                })}
              </tr>
            )}
          </tbody>
        ))}
      </table>
    </section>
  )
}
