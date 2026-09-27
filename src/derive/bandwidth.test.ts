import { describe, expect, it } from 'vitest'
import { createEmptyPlan } from '../model/defaults'
import { podPlan } from './podPlan.fixture'
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

  it('reports the oversubscription of the Production template', () => {
    const plan = templates.find((t) => t.id === 'production')!.build()
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
    // One pod: 2 leaves x 1 link x 100 down per spine; 2 superspines on 2
    // spines is 1 per plane, so 1 x 100 up
    expect(spineBandwidth(partition)).toEqual({ downGbps: 200, upGbps: 100, ratio: 2 })
    // 1:1 needs planes as wide as the pod's leaf links: 2 spines x 2
    expect(requiredSuperspines(partition)).toBe(4)

    partition.fabric.leafSpineLinks = 2
    expect(spineBandwidth(partition)!.ratio).toBe(4)
    expect(requiredSuperspines(partition)).toBe(8)
  })
})

describe('formatBandwidth', () => {
  it('switches to Tbit/s above 1000 Gbit/s', () => {
    expect(formatBandwidth(400)).toBe('400 Gbit/s')
    expect(formatBandwidth(11_500)).toBe('11.5 Tbit/s')
  })
})

describe('spine tier with pods', () => {
  it('compares a pod spine against its plane, not the whole partition', () => {
    // Per pod spine: 2 leaves x 1 link x 100 down, 2 superspines x 100 up
    expect(spineBandwidth(podPlan().partitions[0])).toMatchObject({
      downGbps: 200,
      upGbps: 200,
      ratio: 1,
    })
    // 1:1 needs 2 superspines per plane, 4 in all
    expect(requiredSuperspines(podPlan().partitions[0])).toBe(4)
  })
})

describe('spine tier with a busy central rack', () => {
  it('counts the central rack spines, which carry every pod’s storage traffic', () => {
    const plan = podPlan()
    plan.partitions[0].fabric.storageLeafCount = 4
    // Central rack spine: 2 exits + 4 storage leaves = 600 down, 2 superspines = 200 up;
    // a pod spine is 200 : 200, so the central rack is the worst.
    expect(spineBandwidth(plan.partitions[0])).toMatchObject({
      downGbps: 600,
      upGbps: 200,
      ratio: 3,
    })
    expect(requiredSuperspines(plan.partitions[0])).toBe(2 * 6)
  })
})
