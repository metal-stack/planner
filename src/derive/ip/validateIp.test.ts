import { describe, expect, it } from 'vitest'
import { createEmptyPlan, defaultPartition } from '../../model/defaults'
import { ipPresets } from '../../model/ipPlan'
import type { Plan } from '../../model/plan'
import { templates } from '../../model/templates'
import { validateIpPlan } from './validateIp'

const messages = (plan: Plan, severity?: 'error' | 'warning') =>
  validateIpPlan(plan)
    .filter((i) => !severity || i.severity === severity)
    .map((i) => i.message)

describe('validateIpPlan', () => {
  it('accepts the default plan and every template without errors', () => {
    expect(messages(createEmptyPlan(), 'error')).toEqual([])
    for (const t of templates) expect(messages(t.build(), 'error')).toEqual([])
  })

  it('targets the IPs tab and the field', () => {
    const plan = createEmptyPlan()
    plan.ipPlan.ipv4.shootPodCidr = '10.244.1.0/18'
    const issue = validateIpPlan(plan).find((i) => i.message.includes('Host bits'))
    expect(issue?.target).toEqual({ section: 'ips', field: 'ipv4.shootPodCidr' })
    expect(issue?.severity).toBe('error')
  })

  it('rejects overlapping shoot and seed ranges', () => {
    const plan = createEmptyPlan()
    plan.ipPlan.ipv4.seedPodCidr = '10.244.0.0/17'
    expect(messages(plan, 'error').some((m) => m.includes('VPN between shoot and seed'))).toBe(true)
  })

  it('warns when a pod range leaves the FRR listen range', () => {
    const plan = createEmptyPlan()
    plan.ipPlan.ipv4.shootPodCidr = '10.250.0.0/18'
    expect(messages(plan, 'warning').some((m) => m.includes('outside the FRR listen range'))).toBe(
      true,
    )
  })

  it('reports more partitions than usable slots', () => {
    const plan = createEmptyPlan()
    const large = ipPresets.find((p) => p.id === 'large')!
    plan.ipPlan.ipv4 = structuredClone(large.ipv4)
    for (let i = 2; i <= 8; i++) plan.partitions.push(defaultPartition(`Partition ${i}`))
    expect(messages(plan, 'error').some((m) => m.includes('offers 7 usable /12'))).toBe(true)
  })

  it('checks IPv6 conventions only when dual-stack is on', () => {
    const plan = createEmptyPlan()
    plan.ipPlan.ipv6.projectPrefix = 56
    expect(messages(plan, 'warning').some((m) => m.includes('SLAAC'))).toBe(true)
    plan.ipPlan.ipv6.enabled = false
    expect(messages(plan).some((m) => m.includes('SLAAC'))).toBe(false)
  })

  it('warns about a non-private IPv4 project CIDR', () => {
    const plan = createEmptyPlan()
    plan.ipPlan.ipv4.projectCidr = '100.64.0.0/10'
    plan.ipPlan.ipv4.partitionPrefix = 14
    expect(messages(plan, 'warning').some((m) => m.includes('RFC 1918'))).toBe(true)
  })

  it('warns when a partition plans more workers than one cluster can hold', () => {
    const plan = templates.find((t) => t.id === 'redundant')!.build()
    // compact preset: 16 workers per shoot cluster, the template plans 224
    const w = messages(plan, 'warning').find((m) => m.includes('at most 16 workers'))
    expect(w).toContain('Partition 1 plans 224')
  })

  it('checks the infrastructure CIDR, block count and block size', () => {
    const plan = createEmptyPlan()
    plan.ipPlan.infra.cidr = '10.0.0.0/16'
    expect(messages(plan, 'error').some((m) => m.includes('overlaps the IPv4 project CIDR'))).toBe(
      true,
    )

    const blocks = createEmptyPlan()
    blocks.ipPlan.infra.partitionPrefix = 16
    blocks.partitions.push(defaultPartition('Partition 2'))
    expect(messages(blocks, 'error').some((m) => m.includes('holds 1 /16 blocks'))).toBe(true)

    const small = createEmptyPlan()
    small.ipPlan.infra.partitionPrefix = 25
    expect(messages(small, 'error').some((m) => m.includes('needs a /23'))).toBe(true)
  })
})
