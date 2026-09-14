import type { IpFamilyKey } from '../../model/ipPlan'
import type { Plan } from '../../model/plan'
import { partitionNodes } from '../nodes'
import type { Issue } from '../validate'
import { contains, formatCidr, formatCount, overlaps, parseCidr, WIDTH, type Cidr } from './cidr'
import {
  CIDR_FIELD_LABEL,
  CIDR_FIELDS,
  deriveIpPlan,
  largestCluster,
  type FamilyResult,
  type IpPlanResult,
} from './ipPlan'

// Validation of the IP plan. Issues target the IPs tab (`section: 'ips'`)
// and a field id ("ipv4.shootPodCidr", "infra.cidr", …) the tab uses as
// anchor, so the issue list can jump to the input that fixes it.

const FAMILY_LABEL: Record<IpFamilyKey, string> = { ipv4: 'IPv4', ipv6: 'IPv6' }

const RFC1918 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'].map((s) => {
  const r = parseCidr(s)
  if (!r.ok) throw new Error(s)
  return r.cidr
})

function issue(
  issues: Issue[],
  severity: Issue['severity'],
  where: string,
  field: string,
  message: string,
): void {
  issues.push({ severity, where, message, target: { section: 'ips', field } })
}

function validateFamily(issues: Issue[], plan: Plan, f: FamilyResult): void {
  const fam = FAMILY_LABEL[f.key]
  const W = WIDTH[f.family]
  const field = (name: string) => `${f.key}.${name}`
  const input = f.input

  // Parse errors.
  for (const [name, result] of Object.entries(f.parsed)) {
    if (result.ok) continue
    const [base, index] = name.split('.')
    const label =
      base === 'internetCidrs'
        ? `Internet range ${Number(index) + 1}`
        : base === 'reserveCidrs'
          ? `Reserve range ${Number(index) + 1}`
          : CIDR_FIELD_LABEL[base as (typeof CIDR_FIELDS)[number]]
    issue(issues, 'error', `${fam} · ${label}`, field(name), result.error)
  }
  const c = (name: string): Cidr | null => {
    const r = f.parsed[name]
    return r && r.ok ? r.cidr : null
  }
  const project = c('projectCidr')
  const shootPod = c('shootPodCidr')
  const seedPod = c('seedPodCidr')
  const frr = c('frrListenRange')

  // Prefix lengths.
  for (const [name, value, label] of [
    ['partitionPrefix', input.partitionPrefix, 'Partition super-network prefix'],
    ['projectPrefix', input.projectPrefix, 'Project network prefix'],
    ['nodePodPrefix', input.nodePodPrefix, 'Per-node pod prefix'],
  ] as const) {
    if (value > W)
      issue(
        issues,
        'error',
        `${fam} · ${label}`,
        field(name),
        `/${value} is longer than ${W} bits.`,
      )
  }
  if (project && input.partitionPrefix < project.prefix) {
    issue(
      issues,
      'error',
      `${fam} · Partition super-network prefix`,
      field('partitionPrefix'),
      `A /${input.partitionPrefix} super network does not fit into the project CIDR ${formatCidr(project)}.`,
    )
  }
  if (input.projectPrefix < input.partitionPrefix) {
    issue(
      issues,
      'error',
      `${fam} · Project network prefix`,
      field('projectPrefix'),
      `A /${input.projectPrefix} project network does not fit into a /${input.partitionPrefix} partition super network.`,
    )
  }
  for (const [pod, label] of [
    [shootPod, 'Shoot pod CIDR'],
    [seedPod, 'Seed pod CIDR'],
  ] as const) {
    if (pod && input.nodePodPrefix < pod.prefix) {
      issue(
        issues,
        'error',
        `${fam} · Per-node pod prefix`,
        field('nodePodPrefix'),
        `The per-node pod range /${input.nodePodPrefix} is larger than the ${label.toLowerCase()} ${formatCidr(pod)}.`,
      )
    }
  }

  // Seed and shoot ranges must not overlap (VPN between shoot and seed).
  const gardener: [string, string, Cidr | null][] = [
    ['shootPodCidr', 'Shoot pod CIDR', shootPod],
    ['shootServiceCidr', 'Shoot service CIDR', c('shootServiceCidr')],
    ['seedPodCidr', 'Seed pod CIDR', seedPod],
    ['seedServiceCidr', 'Seed service CIDR', c('seedServiceCidr')],
    ...input.reserveCidrs.map((_, i): [string, string, Cidr | null] => [
      `reserveCidrs.${i}`,
      `Reserve range ${i + 1}`,
      c(`reserveCidrs.${i}`),
    ]),
  ]
  for (let i = 0; i < gardener.length; i++) {
    for (let j = i + 1; j < gardener.length; j++) {
      const [, la, a] = gardener[i]
      const [nb, lb, b] = gardener[j]
      if (a && b && overlaps(a, b)) {
        issue(
          issues,
          'error',
          `${fam} · Kubernetes ranges`,
          field(nb),
          `${la} ${formatCidr(a)} overlaps ${lb.toLowerCase()} ${formatCidr(b)}. Shoot and seed ranges must not overlap because of the VPN between shoot and seed.`,
        )
      }
    }
  }
  // Kubernetes ranges must stay clear of the public internet ranges.
  input.internetCidrs.forEach((_, i) => {
    const net = c(`internetCidrs.${i}`)
    if (!net) return
    for (const [name, label, k] of gardener) {
      if (k && overlaps(k, net)) {
        issue(
          issues,
          'error',
          `${fam} · Kubernetes ranges`,
          field(name),
          `${label} ${formatCidr(k)} overlaps internet range ${formatCidr(net)}.`,
        )
      }
    }
  })

  // Pods must sit in the FRR listen range to peer with FRR on the machine.
  if (frr) {
    for (const [pod, name, label] of [
      [shootPod, 'shootPodCidr', 'Shoot pod CIDR'],
      [seedPod, 'seedPodCidr', 'Seed pod CIDR'],
    ] as const) {
      if (pod && !contains(frr, pod)) {
        issue(
          issues,
          'warning',
          `${fam} · ${label}`,
          field(name),
          `${label} ${formatCidr(pod)} lies outside the FRR listen range ${formatCidr(frr)}, so pods such as metal-lb cannot peer with FRR on the machine.`,
        )
      }
    }
  }

  // Partition slots.
  const usable = f.metrics.usableSlots.value
  if (usable !== null && BigInt(plan.partitions.length) > usable) {
    issue(
      issues,
      'error',
      `${fam} · Partitions`,
      field('partitionPrefix'),
      `The plan has ${plan.partitions.length} partitions but the project CIDR offers ${formatCount(usable)} usable /${input.partitionPrefix} super networks. Use a larger project CIDR or a longer partition prefix.`,
    )
  }

  // Family-specific conventions.
  if (f.family === 6) {
    if (input.projectPrefix !== 64) {
      issue(
        issues,
        'warning',
        `${fam} · Project network prefix`,
        field('projectPrefix'),
        `IPv6 networks are normally /64 (required for SLAAC); this plan uses /${input.projectPrefix}.`,
      )
    }
    if (input.tenantPrefix !== 64) {
      issue(
        issues,
        'warning',
        `${fam} · Tenant prefix`,
        field('tenantPrefix'),
        `IPv6 tenant networks are normally /64; this plan uses /${input.tenantPrefix}.`,
      )
    }
    const internet = input.internetCidrs
      .map((_, i) => c(`internetCidrs.${i}`))
      .filter((x): x is Cidr => !!x)
    if (project && internet.length > 0 && !internet.some((n) => contains(n, project))) {
      issue(
        issues,
        'warning',
        `${fam} · Project CIDR`,
        field('projectCidr'),
        `The IPv6 project CIDR ${formatCidr(project)} is not part of an internet range, so project networks are not reachable from the internet without NAT.`,
      )
    }
  } else if (project && !RFC1918.some((r) => contains(r, project))) {
    issue(
      issues,
      'warning',
      `${fam} · Project CIDR`,
      field('projectCidr'),
      `${formatCidr(project)} is not a private (RFC 1918) range.`,
    )
  }

  // Cluster size against the plan's workers.
  const largest = largestCluster(f)
  if (largest) {
    const over = plan.partitions
      .map((p) => ({ name: p.name, workers: partitionNodes(p).byRole.worker ?? 0 }))
      .filter((p) => BigInt(p.workers) > largest.value)
    if (over.length > 0) {
      issue(
        issues,
        'warning',
        `${fam} · Cluster size`,
        field('shootPodCidr'),
        `A single cluster can have at most ${formatCount(largest.value)} workers (limited by the ${largest.limitedBy}); ` +
          over.map((p) => `${p.name} plans ${p.workers}`).join(', ') +
          ' — fine for several clusters, but no single cluster can use them all.',
      )
    }
  }
}

function validateInfra(issues: Issue[], plan: Plan, r: IpPlanResult): void {
  const { infra } = r
  const where = 'Infrastructure'
  if (!infra.parsed.ok) {
    issue(issues, 'error', `${where} · CIDR`, 'infra.cidr', infra.parsed.error)
    return
  }
  const base = infra.parsed.cidr
  if (infra.input.partitionPrefix < base.prefix) {
    issue(
      issues,
      'error',
      `${where} · Block per partition`,
      'infra.partitionPrefix',
      `A /${infra.input.partitionPrefix} block does not fit into ${formatCidr(base)}.`,
    )
  }
  if (infra.input.transferPrefix > 31) {
    issue(
      issues,
      'error',
      `${where} · Transfer networks`,
      'infra.transferPrefix',
      `A /${infra.input.transferPrefix} cannot hold a point-to-point link; use /30 or /31.`,
    )
  }
  const others: [string, Cidr | null][] = [
    ['the IPv4 project CIDR', r.ipv4.parsed.projectCidr.ok ? r.ipv4.parsed.projectCidr.cidr : null],
    ...CIDR_FIELDS.filter((f) => f !== 'projectCidr' && f !== 'frrListenRange').map(
      (f): [string, Cidr | null] => [
        `the ${CIDR_FIELD_LABEL[f].toLowerCase()}`,
        r.ipv4.parsed[f].ok ? r.ipv4.parsed[f].cidr : null,
      ],
    ),
    ...r.ipv4.input.internetCidrs.map((_, i): [string, Cidr | null] => {
      const p = r.ipv4.parsed[`internetCidrs.${i}`]
      return [`internet range ${i + 1}`, p.ok ? p.cidr : null]
    }),
  ]
  for (const [label, other] of others) {
    if (other && overlaps(base, other)) {
      issue(
        issues,
        'error',
        `${where} · CIDR`,
        'infra.cidr',
        `The infrastructure CIDR ${formatCidr(base)} overlaps ${label} ${formatCidr(other)}.`,
      )
    }
  }
  if (infra.blocks !== null && BigInt(plan.partitions.length) > infra.blocks) {
    issue(
      issues,
      'error',
      `${where} · Block per partition`,
      'infra.partitionPrefix',
      `The plan has ${plan.partitions.length} partitions but ${formatCidr(base)} holds ${formatCount(infra.blocks)} /${infra.input.partitionPrefix} blocks.`,
    )
  }
  for (const p of infra.partitions) {
    if (p.overflow && p.block) {
      issue(
        issues,
        'error',
        `${where} · ${p.partitionName}`,
        'infra.partitionPrefix',
        `${p.partitionName} needs a /${p.requiredPrefix} for its infrastructure subnets, but its block ${formatCidr(p.block)} is a /${p.block.prefix}.`,
      )
    }
  }
}

export function validateIpPlan(plan: Plan, result: IpPlanResult = deriveIpPlan(plan)): Issue[] {
  const issues: Issue[] = []
  validateFamily(issues, plan, result.ipv4)
  if (result.ipv6.enabled) validateFamily(issues, plan, result.ipv6)
  validateInfra(issues, plan, result)
  return issues
}
