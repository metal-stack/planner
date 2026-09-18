import { describe, expect, it } from 'vitest'
import { createEmptyPlan, defaultPartition } from '../../model/defaults'
import { ipPresets } from '../../model/ipPlan'
import type { Plan } from '../../model/plan'
import { templates } from '../../model/templates'
import { formatCidr, formatIp } from './cidr'
import { deriveIpPlan, largestCluster, type FamilyResult, type MetricId } from './ipPlan'

// The expectations below are the numbers of the address-planning
// spreadsheet (ip_calc.ods) for the three layouts the presets mirror.

function planWithPreset(id: string, partitions = 1): Plan {
  const plan = createEmptyPlan()
  const preset = ipPresets.find((p) => p.id === id)!
  plan.ipPlan.ipv4 = structuredClone(preset.ipv4)
  plan.ipPlan.ipv6 = { ...structuredClone(preset.ipv6), enabled: true }
  for (let i = 1; i < partitions; i++) plan.partitions.push(defaultPartition(`Partition ${i + 1}`))
  return plan
}

const v = (f: FamilyResult, id: MetricId) => f.metrics[id].value

describe('compact pod ranges (FCN sheet)', () => {
  const r = deriveIpPlan(planWithPreset('compact', 3))

  it('reproduces the IPv4 limits', () => {
    expect(v(r.ipv4, 'maxShootWorkers')).toBe(16n)
    expect(v(r.ipv4, 'podIpsPerWorker')).toBe(1024n)
    expect(v(r.ipv4, 'maxPods')).toBe(512n)
    expect(v(r.ipv4, 'partitionSlots')).toBe(64n)
    expect(v(r.ipv4, 'projectNetworksPerPartition')).toBe(256n)
    // the sheet's "3 × 2^(22 − 14) = 768" is three partitions
    expect(v(r.ipv4, 'projectNetworksPlan')).toBe(768n)
    expect(v(r.ipv4, 'addressesPerProjectNetwork')).toBe(1024n)
    expect(v(r.ipv4, 'publicAddresses')).toBe(512n)
  })

  it('blocks the /14 slot that holds the Kubernetes ranges', () => {
    expect(v(r.ipv4, 'usableSlots')).toBe(63n)
    expect(r.ipv4.allocations.map((a) => formatCidr(a.cidr!))).toEqual([
      '10.0.0.0/14',
      '10.4.0.0/14',
      '10.8.0.0/14',
    ])
  })

  it('reproduces the IPv6 limits', () => {
    expect(v(r.ipv6, 'maxTenants')).toBe(1_048_576n)
    expect(v(r.ipv6, 'projectNetworksPerPartition')).toBe(4096n)
    expect(v(r.ipv6, 'partitionSlots')).toBe(128n)
    expect(v(r.ipv6, 'maxShootWorkers')).toBe(1024n)
    expect(r.ipv6.metrics.maxTenants.formula).toBe('2^(64 − 44) = 1,048,576')
    expect(formatCidr(r.ipv6.allocations[1].cidr!)).toBe('2001:db8:e0a0:1000::/52')
  })
})

describe('wide pod ranges (Metal Stack Cloud sheet)', () => {
  it('reproduces workers and pods, and blocks four /14 slots', () => {
    const r = deriveIpPlan(planWithPreset('wide'))
    expect(v(r.ipv4, 'maxShootWorkers')).toBe(256n)
    expect(v(r.ipv4, 'podIpsPerWorker')).toBe(1024n)
    expect(v(r.ipv4, 'usableSlots')).toBe(60n)
  })
})

describe('large clusters (draft allocation)', () => {
  const r = deriveIpPlan(planWithPreset('large', 7))

  it('reproduces the draft limits', () => {
    expect(v(r.ipv4, 'maxShootWorkers')).toBe(1024n)
    expect(v(r.ipv4, 'podIpsPerWorker')).toBe(512n)
    expect(v(r.ipv4, 'maxPods')).toBe(256n)
    expect(v(r.ipv4, 'partitionSlots')).toBe(8n)
    expect(v(r.ipv4, 'usableSlots')).toBe(7n)
    expect(v(r.ipv4, 'projectNetworksPerPartition')).toBe(1024n)
    expect(v(r.ipv4, 'maxSeedWorkers')).toBe(32n)
    expect(v(r.ipv4, 'shootServices')).toBe(16_384n)
  })

  it('allocates partitions A–G of the draft', () => {
    expect(r.ipv4.allocations.map((a) => formatCidr(a.cidr!))).toEqual([
      '10.128.0.0/12',
      '10.144.0.0/12',
      '10.160.0.0/12',
      '10.176.0.0/12',
      '10.192.0.0/12',
      '10.208.0.0/12',
      '10.224.0.0/12',
    ])
  })

  it('leaves an eighth partition without a slot', () => {
    const r8 = deriveIpPlan(planWithPreset('large', 8))
    expect(r8.ipv4.allocations[7].cidr).toBeNull()
  })

  it('builds the example cluster', () => {
    const ex = r.ipv4.example!
    expect(formatCidr(ex.projectNetwork)).toBe('10.128.0.0/22')
    expect(ex.nodeAddresses.map((a) => formatIp(4, a))).toEqual([
      '10.128.0.1',
      '10.128.0.2',
      '10.128.0.3',
    ])
    expect(ex.nodePodCidrs.map(formatCidr)).toEqual([
      '10.240.0.0/23',
      '10.240.2.0/23',
      '10.240.4.0/23',
    ])
    expect(formatIp(4, ex.firstServiceAddress)).toBe('10.248.0.1')
  })

  it('names the limiting range of the largest cluster', () => {
    expect(largestCluster(r.ipv4)?.value).toBe(1024n)
    const compact = deriveIpPlan(planWithPreset('compact'))
    expect(largestCluster(compact.ipv4)).toEqual({
      value: 16n,
      limitedBy: 'shoot pod CIDR /18 with /22 per node',
    })
  })
})

describe('invalid input', () => {
  it('reports parse errors and leaves dependent metrics empty', () => {
    const plan = createEmptyPlan()
    plan.ipPlan.ipv4.shootPodCidr = '10.244.1.0/18'
    const r = deriveIpPlan(plan)
    expect(r.ipv4.parsed.shootPodCidr.ok).toBe(false)
    expect(v(r.ipv4, 'maxShootWorkers')).toBeNull()
    expect(v(r.ipv4, 'podIpsPerWorker')).toBe(1024n)
  })
})

describe('infrastructure ranges', () => {
  it('sizes underlay, PXE, management and transfer nets for the default plan', () => {
    const r = deriveIpPlan(createEmptyPlan())
    const p = r.infra.partitions[0]
    const byPurpose = Object.fromEntries(p.subnets.map((s) => [`${s.purpose}|${s.scope}`, s]))
    // 2 leaves + 2 spines + 2 exits + 4 firewalls = 10, doubled = 20 → /27
    expect(byPurpose['Underlay loopbacks|Partition']).toMatchObject({ needed: 10, prefix: 27 })
    // 8 nodes + 2 exit SVIs = 10, doubled + 3 reserved = 23 → /27
    expect(byPurpose['PXE (vlan4000)|Partition']).toMatchObject({
      needed: 10,
      sized: 23,
      prefix: 27,
    })
    // L3 management: central 2 spines + 2 exits + 2 mgmt spines + 2 mgmt servers × 2 + 2 routers
    expect(byPurpose['Management|Central rack']).toMatchObject({ needed: 12, prefix: 27 })
    // rack: 2 leaves + 1 mgmt leaf + 8 BMCs
    expect(byPurpose['Management|Rack 1']).toMatchObject({ needed: 11, prefix: 27 })
    // 2 routers × 2 exits × 2 links × /30 = 32 addresses
    expect(byPurpose['Transfer networks|Partition']).toMatchObject({ needed: 8, prefix: 27 })
    expect(formatCidr(p.block!)).toBe('172.16.0.0/20')
    expect(p.overflow).toBe(false)
    expect(p.requiredPrefix).toBe(24)
    expect(p.subnets.every((s) => s.cidr !== null)).toBe(true)
  })

  it('uses one management subnet per partition for an L2 management network', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].fabric.mgmt.layer = 'l2'
    const p = deriveIpPlan(plan).infra.partitions[0]
    expect(p.subnets.filter((s) => s.purpose === 'Management').map((s) => s.scope)).toEqual([
      'Partition',
    ])
  })

  it('sizes the Redundant template per rack group and overflows a small block', () => {
    const plan = templates.find((t) => t.id === 'redundant')!.build()
    const p = deriveIpPlan(plan).infra.partitions[0]
    const pxe = p.subnets.find((s) => s.purpose === 'PXE (vlan4000)')!
    expect(pxe).toMatchObject({ needed: 229, prefix: 23 })
    const racks = p.subnets.filter((s) => s.purpose === 'Management' && s.scope !== 'Central rack')
    expect(racks.map((s) => [s.scope, s.needed, s.prefix])).toEqual([
      ['Rack group 1', 118, 24],
      ['Rack group 2', 115, 24],
    ])
    plan.ipPlan.infra.partitionPrefix = 23
    const small = deriveIpPlan(plan).infra.partitions[0]
    expect(small.overflow).toBe(true)
    // 512 PXE + 2 × 256 rack mgmt + 3 × 32 (underlay, central mgmt, transfer) = 1120
    expect(small.requiredPrefix).toBe(21)
  })
})
