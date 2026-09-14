import { describe, expect, it } from 'vitest'
import { createEmptyPlan } from '../model/defaults'
import { templates } from '../model/templates'
import {
  formatBandwidth,
  formatGbps,
  formatRatio,
  rackBandwidth,
  requiredLeafSpineLinks,
  requiredSuperspines,
  spineBandwidth,
} from './bandwidth'

describe('rackBandwidth', () => {
  it('is exactly non-blocking for the default plan', () => {
    const plan = createEmptyPlan()
    const partition = plan.partitions[0]
    // 8 nodes x 50 Gbit/s = 400 against 2 leaves x 2 spines x 1 link x 100
    expect(rackBandwidth(partition.racks[0], partition)).toEqual({
      downGbps: 400,
      upGbps: 400,
      ratio: 1,
    })
  })

  it('counts 2x100G groups with 200 Gbit/s per node', () => {
    const plan = createEmptyPlan()
    const partition = plan.partitions[0]
    partition.racks[0].servers[0].uplink = '2x100G'
    expect(rackBandwidth(partition.racks[0], partition)).toMatchObject({ downGbps: 1600, ratio: 4 })
  })

  it('halves the ratio when the leaf ↔ spine bundle doubles', () => {
    const plan = createEmptyPlan()
    const partition = plan.partitions[0]
    partition.fabric.leafSpineLinks = 2
    expect(rackBandwidth(partition.racks[0], partition).ratio).toBe(0.5)
    expect(requiredLeafSpineLinks(partition.racks[0], partition)).toBe(1)
  })

  it('has no ratio without uplinks or without servers', () => {
    const plan = createEmptyPlan()
    const partition = plan.partitions[0]
    partition.fabric.spineCount = 0
    expect(rackBandwidth(partition.racks[0], partition).ratio).toBeNull()
    partition.fabric.spineCount = 2
    partition.racks[0].servers = []
    expect(rackBandwidth(partition.racks[0], partition).ratio).toBeNull()
  })

  it('reports the oversubscription of the Redundant template', () => {
    const plan = templates.find((t) => t.id === 'redundant')!.build()
    const partition = plan.partitions[0]
    // 112 workers + 3 storage nodes x 50 Gbit/s = 5750 against 400
    const b = rackBandwidth(partition.racks[0], partition)
    expect(b.downGbps).toBe(5750)
    expect(formatRatio(b.ratio)).toBe('14.4 : 1')
    expect(requiredLeafSpineLinks(partition.racks[0], partition)).toBe(15)
    expect(formatGbps(b.downGbps)).toBe('5,750 Gbit/s')
  })
})

describe('spineBandwidth', () => {
  it('is null without a superspine tier', () => {
    expect(spineBandwidth(createEmptyPlan().partitions[0])).toBeNull()
  })

  it('compares leaf uplinks with superspine uplinks per spine', () => {
    const plan = createEmptyPlan()
    const partition = plan.partitions[0]
    partition.fabric.fabricType = 'leaf-spine-superspine'
    partition.fabric.superspineCount = 2
    // 2 leaves x 1 link x 100 down, 2 superspines x 100 up
    expect(spineBandwidth(partition)).toEqual({ downGbps: 200, upGbps: 200, ratio: 1 })
    expect(requiredSuperspines(partition)).toBe(2)

    partition.fabric.leafSpineLinks = 2
    expect(spineBandwidth(partition)!.ratio).toBe(2)
    expect(requiredSuperspines(partition)).toBe(4)
  })
})

describe('formatBandwidth', () => {
  it('switches to Tbit/s above 1000 Gbit/s', () => {
    expect(formatBandwidth(400)).toBe('400 Gbit/s')
    expect(formatBandwidth(11_500)).toBe('11.5 Tbit/s')
  })
})
