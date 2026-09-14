import { describe, expect, it } from 'vitest'
import { deriveIpPlan } from '../derive/ip/ipPlan'
import { createEmptyPlan } from '../model/defaults'
import { ipPlanToCsv } from './ipCsv'

describe('ipPlanToCsv', () => {
  it('lists plan ranges, partition super networks, infrastructure and limits', () => {
    const lines = ipPlanToCsv(deriveIpPlan(createEmptyPlan())).trimEnd().split('\r\n')
    expect(lines[0]).toBe('Scope,Family,Purpose,CIDR,Size,Derived from')
    expect(lines).toContain('Plan,IPv4,Shoot pod CIDR,10.244.0.0/18,"16,384",')
    expect(lines).toContain(
      'Partition 1,IPv4,Partition super network,10.0.0.0/14,"262,144",project networks of /22',
    )
    expect(
      lines.some((l) => l.startsWith('Partition 1 / Partition,IPv4,PXE (vlan4000),172.16.')),
    ).toBe(true)
    expect(lines).toContain('Limits,IPv4,Max workers per shoot cluster,,16,2^(22 − 18) = 16')
    expect(lines.some((l) => l.includes(',IPv6,'))).toBe(true)
  })

  it('leaves IPv6 out when dual-stack is off', () => {
    const plan = createEmptyPlan()
    plan.ipPlan.ipv6.enabled = false
    expect(ipPlanToCsv(deriveIpPlan(plan)).includes(',IPv6,')).toBe(false)
  })
})
