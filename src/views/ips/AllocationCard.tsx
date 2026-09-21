import { commonSupernet, contains, formatCidr, size, type Cidr } from '../../derive/ip/cidr'
import type { FamilyResult, IpPlanResult } from '../../derive/ip/ipPlan'
import RangeBar, { type BarSegment } from './RangeBar'
import { Icon, SECTION_ICON } from '../icons'
import { COLOR as PALETTE } from '../colors'

const COLOR = {
  partition: PALETTE.brand,
  blocked: PALETTE.dangerSoft,
  shootPod: PALETTE.production,
  shootService: PALETTE.service,
  seedPod: PALETTE.seed,
  seedService: PALETTE.seedSoft,
  reserve: PALETTE.gray400,
}

function projectMap(f: FamilyResult): { domain: Cidr; segments: BarSegment[] } | null {
  const p = f.parsed.projectCidr
  if (!p.ok) return null
  const segments: BarSegment[] = [
    ...f.blocking
      .filter((b) => !(b.label.startsWith('Internet') && contains(b.cidr, p.cidr)))
      .map((b) => ({ cidr: b.cidr, label: `Other ranges`, color: COLOR.blocked })),
    ...f.allocations
      .filter((a) => a.cidr)
      .map((a) => ({ cidr: a.cidr!, label: 'Partitions', color: COLOR.partition })),
  ]
  return { domain: p.cidr, segments }
}

function kubernetesMap(f: FamilyResult): { domain: Cidr; segments: BarSegment[] } | null {
  const pools: BarSegment[] = []
  const add = (field: string, label: string, color: string) => {
    const r = f.parsed[field]
    if (r?.ok) pools.push({ cidr: r.cidr, label, color })
  }
  add('shootPodCidr', 'Shoot pods', COLOR.shootPod)
  add('shootServiceCidr', 'Shoot services', COLOR.shootService)
  add('seedPodCidr', 'Seed pods', COLOR.seedPod)
  add('seedServiceCidr', 'Seed services', COLOR.seedService)
  f.input.reserveCidrs.forEach((_, i) => add(`reserveCidrs.${i}`, 'Reserve', COLOR.reserve))
  if (pools.length === 0) return null
  const cover = commonSupernet(pools.map((p) => p.cidr))
  // Show the FRR listen range when it frames the pools; a huge one (e.g.
  // 0.0.0.0/0) would shrink them to nothing, so fall back to their cover.
  const frr = f.parsed.frrListenRange
  const domain =
    frr.ok && contains(frr.cidr, cover) && size(frr.cidr) <= size(cover) * 16n ? frr.cidr : cover
  return { domain, segments: pools }
}

/** Super network per plan partition, and maps of the project CIDR and the
 *  Kubernetes ranges. */
export default function AllocationCard({ result }: { result: IpPlanResult }) {
  const families = [result.ipv4, ...(result.ipv6.enabled ? [result.ipv6] : [])]
  const rows = result.ipv4.allocations.map((a, i) => ({
    name: a.partitionName,
    v4: a.cidr,
    v6: result.ipv6.allocations[i]?.cidr ?? null,
    infra: result.infra.partitions[i]?.block ?? null,
  }))
  const missing = <span className="text-xs text-red-700">no free slot</span>

  return (
    <section className="card p-4">
      <h3 className="text-sm font-semibold">
        <Icon
          icon={SECTION_ICON.partition}
          className="mr-1.5 inline h-4 w-4 align-[-3px] text-gray-500"
        />
        Partition allocation
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="py-1.5 pr-3 font-semibold">Partition</th>
              <th className="py-1.5 pr-3 font-semibold">IPv4 super network</th>
              {result.ipv6.enabled && (
                <th className="py-1.5 pr-3 font-semibold">IPv6 super network</th>
              )}
              <th className="py-1.5 font-semibold">Infrastructure block</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-gray-100">
                <td className="py-1.5 pr-3">{r.name}</td>
                <td className="py-1.5 pr-3 font-mono text-xs">
                  {r.v4 ? formatCidr(r.v4) : missing}
                </td>
                {result.ipv6.enabled && (
                  <td className="py-1.5 pr-3 font-mono text-xs">
                    {r.v6 ? formatCidr(r.v6) : missing}
                  </td>
                )}
                <td className="py-1.5 font-mono text-xs">
                  {r.infra ? (
                    formatCidr(r.infra)
                  ) : (
                    <span className="text-xs text-red-700">no block</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {families.map((f) => {
          const pm = projectMap(f)
          const km = kubernetesMap(f)
          const fam = f.key === 'ipv4' ? 'IPv4' : 'IPv6'
          return (
            <div key={f.key} className="space-y-3">
              {pm && (
                <RangeBar
                  domain={pm.domain}
                  segments={pm.segments}
                  caption={`${fam} project CIDR ${formatCidr(pm.domain)}`}
                />
              )}
              {km && (
                <RangeBar
                  domain={km.domain}
                  segments={km.segments}
                  caption={`${fam} Kubernetes ranges in ${formatCidr(km.domain)}`}
                />
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
