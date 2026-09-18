import { describe, expect, it } from 'vitest'
import { createEmptyPlan } from '../../model/defaults'
import { templates } from '../../model/templates'
import { deriveDevices } from '../devices'
import { contains, formatCidr, parseIp, type Cidr } from './cidr'
import { deriveDeviceAddresses } from './deviceAddresses'
import { deriveIpPlan } from './ipPlan'

function derive(plan = createEmptyPlan()) {
  const devices = deriveDevices(plan)
  const ip = deriveIpPlan(plan)
  return { devices, ip, addresses: deriveDeviceAddresses(plan, ip, devices) }
}

const inside = (cidr: Cidr, ip: string) =>
  contains(cidr, { family: 4, addr: parseIp(ip)!.addr, prefix: 32 })

describe('device addresses', () => {
  it('addresses every device of the default plan', () => {
    const { addresses, ip } = derive()
    const [a] = addresses
    expect(a.notes).toEqual([])
    const subnet = (kind: string, rackId?: string) =>
      ip.infra.partitions[0].subnets.find((s) => s.kind === kind && s.rackId === rackId)!.cidr!
    const host = (name: string) => a.byHost.get(`partition-1-${name}`)!
    expect(host('spine01').loopback).toBe('172.16.0.129')
    expect(inside(subnet('underlay'), host('r01leaf02').loopback!)).toBe(true)
    expect(inside(subnet('mgmt-loopbacks'), host('mgmtspine01').loopback!)).toBe(true)
    // Central switches in the central management subnet, gateway first.
    expect(host('spine01').mgmt).toEqual({
      ip: '172.16.0.162',
      prefix: 27,
      gateway: '172.16.0.161',
    })
    // Rack switches in the rack's subnet.
    expect(host('r01leaf01').mgmt!.gateway).toBe(host('r01mgmtleaf').mgmt!.gateway)
    // PXE: 4 /27 slices of the /25, exits first, then one per leaf.
    expect(formatCidr(a.pxe!)).toBe('172.16.0.0/25')
    expect(host('exit01').pxe).toBe('172.16.0.1/27')
    expect(host('exit02').pxe).toBe('172.16.0.2/27')
    expect(host('r01leaf01').pxe).toBe('172.16.0.33/27')
    expect(host('r01leaf02').pxe).toBe('172.16.0.65/27')
    // 2 routers × 2 exits × 2 links.
    expect(a.transfers).toHaveLength(8)
    expect(a.transfers[0]).toMatchObject({
      exit: 'partition-1-exit01',
      router: 'partition-1-inet01',
      link: 1,
    })
  })

  it('never hands out an address twice and leaves room for BMCs', () => {
    for (const t of templates) {
      const { addresses } = derive(t.build())
      for (const a of addresses) {
        expect(a.notes).toEqual([])
        const all = [...a.byHost.values()].flatMap((d) => [d.loopback, d.mgmt?.ip, d.pxe])
        const used = all.filter((x): x is string => !!x).map((x) => x.split('/')[0])
        expect(new Set(used).size).toBe(used.length)
        for (const s of a.mgmtSubnets) expect(s.dhcpRange).not.toBeNull()
      }
    }
  })

  it('uses one management subnet and no management loopbacks for L2', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].fabric.mgmt.layer = 'l2'
    const [a] = derive(plan).addresses
    expect(a.mgmtSubnets.map((s) => s.scope)).toEqual(['Partition'])
    expect(a.byHost.get('partition-1-mgmtspine01')!.loopback).toBeNull()
    expect(a.byHost.get('partition-1-r01leaf01')!.mgmt).not.toBeNull()
  })

  it('explains what cannot be addressed', () => {
    const plan = createEmptyPlan()
    plan.ipPlan.infra.cidr = 'nonsense'
    const [a] = derive(plan).addresses
    expect(a.notes[0]).toContain('no infrastructure block')
    expect(a.byHost.get('partition-1-spine01')!.loopback).toBeNull()
  })
})
