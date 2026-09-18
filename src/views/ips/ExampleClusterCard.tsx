import { formatCidr, formatIp } from '../../derive/ip/cidr'
import type { ExampleCluster, IpPlanResult } from '../../derive/ip/ipPlan'
import { Icon, SECTION_ICON } from '../icons'

const ROWS: { label: string; value: (e: ExampleCluster) => string[] }[] = [
  { label: 'Partition super network', value: (e) => [formatCidr(e.superNetwork)] },
  { label: 'First project network', value: (e) => [formatCidr(e.projectNetwork)] },
  {
    label: 'Node addresses',
    value: (e) => e.nodeAddresses.map((a) => formatIp(e.projectNetwork.family, a)),
  },
  { label: 'Shoot pod CIDR', value: (e) => [formatCidr(e.shootPodCidr)] },
  { label: 'Per-node pod ranges', value: (e) => e.nodePodCidrs.map(formatCidr) },
  {
    label: 'Shoot service CIDR',
    value: (e) => [
      formatCidr(e.shootServiceCidr),
      `${formatIp(e.shootServiceCidr.family, e.firstServiceAddress)} (first service IP)`,
    ],
  },
  { label: 'Seed pod CIDR', value: (e) => [formatCidr(e.seedPodCidr)] },
  { label: 'Seed service CIDR', value: (e) => [formatCidr(e.seedServiceCidr)] },
  {
    label: 'Reserve',
    value: (e) => (e.reserveCidrs.length ? e.reserveCidrs.map(formatCidr) : ['–']),
  },
]

/** A concrete cluster in the first partition, like the draft block of the
 *  address-planning spreadsheet. */
export default function ExampleClusterCard({ result }: { result: IpPlanResult }) {
  const families = [result.ipv4, ...(result.ipv6.enabled ? [result.ipv6] : [])]
  const name = result.ipv4.example?.partitionName ?? result.ipv6.example?.partitionName
  return (
    <section className="card p-4">
      <h3 className="text-sm font-semibold">
        <Icon
          icon={SECTION_ICON.example}
          className="mr-1.5 inline h-4 w-4 align-[-3px] text-gray-500"
        />
        Example cluster{' '}
        <span className="font-normal text-gray-500">
          · first project network{name ? ` in ${name}` : ''}
        </span>
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="py-1.5 pr-3 font-semibold" />
              {families.map((f) => (
                <th key={f.key} className="py-1.5 pr-3 font-semibold">
                  {f.key === 'ipv4' ? 'IPv4' : 'IPv6'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-t border-gray-100 align-top">
                <td className="py-1.5 pr-3 text-gray-600">{row.label}</td>
                {families.map((f) => (
                  <td key={f.key} className="py-1.5 pr-3 font-mono text-xs">
                    {f.example ? (
                      row.value(f.example).map((v) => <div key={v}>{v}</div>)
                    ) : (
                      <span className="font-sans text-gray-400">
                        needs valid inputs and a free slot
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
