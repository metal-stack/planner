import { describe, expect, it } from 'vitest'
import { createEmptyPlan, defaultPartition } from '../model/defaults'
import { templates } from '../model/templates'
import { deriveDevices, devicesOf, groupName, slugify } from './devices'

describe('devices', () => {
  it('names the default plan like a deployment repository', () => {
    const [p] = deriveDevices(createEmptyPlan())
    expect(p.slug).toBe('partition-1')
    expect(p.group).toBe('partition_1')
    expect(p.devices.map((d) => d.hostname)).toEqual([
      'partition-1-inet01',
      'partition-1-inet02',
      'partition-1-spine01',
      'partition-1-spine02',
      'partition-1-exit01',
      'partition-1-exit02',
      'partition-1-mgmtspine01',
      'partition-1-mgmtspine02',
      'partition-1-mgmtserver01',
      'partition-1-mgmtserver02',
      'partition-1-r01mgmtleaf',
      'partition-1-r01leaf01',
      'partition-1-r01leaf02',
    ])
  })

  it('numbers ASNs per the metal-stack model: leaves unique, spines and exits shared', () => {
    const plan = createEmptyPlan()
    plan.partitions.push(defaultPartition('Partition 2'))
    const [p1, p2] = deriveDevices(plan)
    const asns = (role: Parameters<typeof devicesOf>[1], p = p1) =>
      devicesOf(p, role).map((d) => d.asn)
    expect(asns('leaf')).toEqual([4200000001, 4200000002])
    expect(asns('spine')).toEqual([4200020000, 4200020000])
    expect(asns('exit')).toEqual([4200030000, 4200030000])
    expect(asns('mgmt-spine')).toEqual([4200040000, 4200040000])
    expect(asns('mgmt-leaf')).toEqual([4200041001])
    expect(asns('mgmt-server')).toEqual([4200045001, 4200045002])
    expect(asns('router')).toEqual([null, null])
    expect(asns('leaf', p2)).toEqual([4200100001, 4200100002])
  })

  it('counts every switch the BOM counts, with unique hostnames', () => {
    for (const t of templates) {
      const plan = t.build()
      const devices = deriveDevices(plan)
      const names = devices.flatMap((p) => p.devices.map((d) => d.hostname))
      expect(new Set(names).size).toBe(names.length)
      plan.partitions.forEach((partition, i) => {
        const leaves = partition.racks.reduce((n, r) => n + r.leafCount, 0)
        expect(devicesOf(devices[i], 'leaf')).toHaveLength(leaves)
        expect(devicesOf(devices[i], 'mgmt-leaf')).toHaveLength(
          partition.racks.length * partition.fabric.mgmt.leafPerRack,
        )
      })
    }
  })

  it('keeps a rack group as one rack', () => {
    const plan = templates.find((t) => t.id === 'redundant')!.build()
    const [p] = deriveDevices(plan)
    expect(p.racks.map((r) => r.tag)).toEqual(['r01', 'r02'])
    expect(devicesOf(p, 'leaf').map((d) => d.hostname)).toEqual([
      'partition-1-r01leaf01',
      'partition-1-r01leaf02',
      'partition-1-r02leaf01',
      'partition-1-r02leaf02',
    ])
  })

  it('makes unique slugs and valid group names', () => {
    expect(slugify(' Frankfurt / Room 2 ')).toBe('frankfurt-room-2')
    expect(groupName('1st-floor')).toBe('p_1st_floor')
    const plan = createEmptyPlan()
    plan.partitions.push(defaultPartition('partition 1'), defaultPartition('***'))
    expect(deriveDevices(plan).map((p) => p.slug)).toEqual([
      'partition-1',
      'partition-1-2',
      'partition-3',
    ])
  })
})
