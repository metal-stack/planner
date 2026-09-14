import { z } from 'zod'

// Address planning inputs (IPs tab). Derived limits, allocations and
// issues live in src/derive/ip/. CIDRs are stored as the raw strings the
// user typed, so half-typed input survives and undo stays simple; the
// derivation parses them and reports errors.
//
// Presets mirror the layouts of the address-planning spreadsheet
// (ip_calc.ods, untracked). Public ranges are always documentation ranges
// (RFC 5737 for IPv4, RFC 3849 for IPv6) — never ship real allocations.

export const IpFamilySchema = z.object({
  /** Public ranges the setup owns (internet network). */
  internetCidrs: z.array(z.string()),
  /** Prefix length handed to a tenant from the internet ranges (IPv6). */
  tenantPrefix: z.number().int().min(0).max(128),
  /** Range the partition super networks are carved from ("cloud-native CIDR"). */
  projectCidr: z.string(),
  /** One super network per partition, project networks are carved from it. */
  partitionPrefix: z.number().int().min(0).max(128),
  /** Size of a project network (one per cluster / project). */
  projectPrefix: z.number().int().min(0).max(128),
  /** Range the FRR on every machine accepts iBGP peerings from (pods, e.g. metal-lb). */
  frrListenRange: z.string(),
  shootPodCidr: z.string(),
  shootServiceCidr: z.string(),
  seedPodCidr: z.string(),
  seedServiceCidr: z.string(),
  /** Kept free for later use (e.g. a larger seed pod range). */
  reserveCidrs: z.array(z.string()).default([]),
  /** Pod range each worker node gets from the pod CIDR. */
  nodePodPrefix: z.number().int().min(0).max(128),
})
export type IpFamily = z.infer<typeof IpFamilySchema>

export const Ipv6FamilySchema = IpFamilySchema.extend({
  /** Dual-stack: plan IPv6 next to IPv4. */
  enabled: z.boolean().default(true),
})
export type Ipv6Family = z.infer<typeof Ipv6FamilySchema>

/** Infrastructure ranges (IPv4): underlay, PXE, management, transfer nets. */
export const IpInfraSchema = z.object({
  cidr: z.string(),
  /** One block of this size per partition. */
  partitionPrefix: z.number().int().min(0).max(32),
  /** Extra room on top of today's device count, in percent. */
  headroomPercent: z.number().int().min(0).max(1000),
  /** Firewalls are EVPN VTEPs and need an underlay loopback each. */
  firewallsPerPartition: z.number().int().min(0),
  /** Prefix of each router ↔ exit transfer network. */
  transferPrefix: z.number().int().min(0).max(32),
})
export type IpInfra = z.infer<typeof IpInfraSchema>

export const IpPlanSchema = z.object({
  ipv4: IpFamilySchema,
  ipv6: Ipv6FamilySchema,
  infra: IpInfraSchema,
})
export type IpPlan = z.infer<typeof IpPlanSchema>

export type IpFamilyKey = 'ipv4' | 'ipv6'

/** RFC 5737 documentation ranges: two halves of one /24 plus a full /24,
 *  the shape a small public allocation usually has. Never ship addresses
 *  from a real installation here. */
const DOC_V4_INTERNET = ['192.0.2.0/25', '192.0.2.128/25', '198.51.100.0/24']

/** IPv6 is the same in all presets: a /44 from the documentation range,
 *  the lower /45 for project networks, Kubernetes ranges in a ULA /48. */
const V6: IpFamily = {
  // RFC 3849 documentation prefix, a randomly picked /44 inside it.
  internetCidrs: ['2001:db8:e0a0::/44'],
  tenantPrefix: 64,
  projectCidr: '2001:db8:e0a0::/45',
  partitionPrefix: 52,
  projectPrefix: 64,
  frrListenRange: 'fd00::/8',
  shootPodCidr: 'fd8e:7a15:7ac6::/54',
  seedPodCidr: 'fd8e:7a15:7ac6:400::/54',
  shootServiceCidr: 'fd8e:7a15:7ac6:800::/64',
  seedServiceCidr: 'fd8e:7a15:7ac6:801::/64',
  reserveCidrs: [],
  nodePodPrefix: 64,
}

export interface IpPreset {
  id: string
  name: string
  description: string
  ipv4: IpFamily
  ipv6: IpFamily
}

export const ipPresets: IpPreset[] = [
  {
    id: 'compact',
    name: 'Compact pod ranges',
    description:
      '10.0.0.0/8 with /14 per partition; pods and services as four /18 in 10.244.0.0/16.',
    ipv4: {
      internetCidrs: DOC_V4_INTERNET,
      tenantPrefix: 32,
      projectCidr: '10.0.0.0/8',
      partitionPrefix: 14,
      projectPrefix: 22,
      frrListenRange: '10.244.0.0/16',
      shootPodCidr: '10.244.0.0/18',
      shootServiceCidr: '10.244.64.0/18',
      seedPodCidr: '10.244.128.0/18',
      seedServiceCidr: '10.244.192.0/18',
      reserveCidrs: [],
      nodePodPrefix: 22,
    },
    ipv6: V6,
  },
  {
    id: 'wide',
    name: 'Wide pod ranges',
    description:
      '10.0.0.0/8 with /14 per partition; pods and services as four /14 in 10.240.0.0/12.',
    ipv4: {
      internetCidrs: DOC_V4_INTERNET,
      tenantPrefix: 32,
      projectCidr: '10.0.0.0/8',
      partitionPrefix: 14,
      projectPrefix: 22,
      frrListenRange: '10.240.0.0/12',
      shootPodCidr: '10.240.0.0/14',
      shootServiceCidr: '10.244.0.0/14',
      seedPodCidr: '10.248.0.0/14',
      seedServiceCidr: '10.252.0.0/14',
      reserveCidrs: [],
      nodePodPrefix: 22,
    },
    ipv6: V6,
  },
  {
    id: 'large',
    name: 'Large clusters',
    description:
      '10.128.0.0/9 with /12 per partition; a /13 pod range with /23 per node (1024 workers).',
    ipv4: {
      internetCidrs: DOC_V4_INTERNET,
      tenantPrefix: 32,
      projectCidr: '10.128.0.0/9',
      partitionPrefix: 12,
      projectPrefix: 22,
      frrListenRange: '0.0.0.0/0',
      shootPodCidr: '10.240.0.0/13',
      shootServiceCidr: '10.248.0.0/18',
      seedPodCidr: '10.248.64.0/18',
      seedServiceCidr: '10.248.192.0/18',
      reserveCidrs: ['10.248.128.0/18'],
      nodePodPrefix: 23,
    },
    ipv6: V6,
  },
]

export const DEFAULT_IP_INFRA: IpInfra = {
  cidr: '172.16.0.0/16',
  partitionPrefix: 20,
  headroomPercent: 100,
  firewallsPerPartition: 4,
  transferPrefix: 30,
}

export function defaultIpPlan(): IpPlan {
  const preset = ipPresets[0]
  return {
    ipv4: structuredClone(preset.ipv4),
    ipv6: { ...structuredClone(preset.ipv6), enabled: true },
    infra: { ...DEFAULT_IP_INFRA },
  }
}
