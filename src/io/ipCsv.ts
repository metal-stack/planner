import { formatCidr, formatCount, size, type Cidr } from '../derive/ip/cidr'
import {
  CIDR_FIELD_LABEL,
  CIDR_FIELDS,
  METRIC_LABEL,
  type FamilyResult,
  type IpPlanResult,
  type MetricId,
} from '../derive/ip/ipPlan'
import { escapeField } from './csv'

type Row = [
  scope: string,
  family: string,
  purpose: string,
  cidr: string,
  size: string,
  derived: string,
]

const cidrRow = (scope: string, family: string, purpose: string, c: Cidr, derived = ''): Row => [
  scope,
  family,
  purpose,
  formatCidr(c),
  formatCount(size(c)),
  derived,
]

function familyRows(f: FamilyResult): Row[] {
  const fam = f.key === 'ipv4' ? 'IPv4' : 'IPv6'
  const rows: Row[] = []
  const parsed = (key: string) => {
    const r = f.parsed[key]
    return r?.ok ? r.cidr : null
  }
  f.input.internetCidrs.forEach((_, i) => {
    const c = parsed(`internetCidrs.${i}`)
    if (c) rows.push(cidrRow('Plan', fam, `Internet range ${i + 1}`, c))
  })
  for (const field of CIDR_FIELDS) {
    const c = parsed(field)
    if (c) rows.push(cidrRow('Plan', fam, CIDR_FIELD_LABEL[field], c))
  }
  f.input.reserveCidrs.forEach((_, i) => {
    const c = parsed(`reserveCidrs.${i}`)
    if (c) rows.push(cidrRow('Plan', fam, `Reserve range ${i + 1}`, c))
  })
  for (const a of f.allocations) {
    if (a.cidr) {
      rows.push(
        cidrRow(
          a.partitionName,
          fam,
          'Partition super network',
          a.cidr,
          `project networks of /${f.input.projectPrefix}`,
        ),
      )
    }
  }
  for (const [id, m] of Object.entries(f.metrics) as [
    MetricId,
    FamilyResult['metrics'][MetricId],
  ][]) {
    if (m.value !== null)
      rows.push(['Limits', fam, METRIC_LABEL[id], '', formatCount(m.value), m.formula])
  }
  return rows
}

/** The address plan as CSV: plan-wide ranges, partition super networks,
 *  infrastructure subnets and the derived limits. */
export function ipPlanToCsv(result: IpPlanResult): string {
  const header: Row = ['Scope', 'Family', 'Purpose', 'CIDR', 'Size', 'Derived from']
  const rows: Row[] = [
    ...familyRows(result.ipv4),
    ...(result.ipv6.enabled ? familyRows(result.ipv6) : []),
  ]
  for (const p of result.infra.partitions) {
    if (p.block) rows.push(cidrRow(p.partitionName, 'IPv4', 'Infrastructure block', p.block))
    for (const s of p.subnets) {
      if (s.cidr)
        rows.push(cidrRow(`${p.partitionName} / ${s.scope}`, 'IPv4', s.purpose, s.cidr, s.detail))
    }
  }
  return [header, ...rows].map((r) => r.map(escapeField).join(',')).join('\r\n') + '\r\n'
}
