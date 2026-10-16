import { describe, expect, it } from 'vitest'
import {
  chassisPositions,
  configBuckets,
  groupConfig,
  nodeConfig,
  nodesAtPosition,
  positionListLabel,
} from './nodeConfig'
import type { ServerGroup } from './plan'

function group(nodeConfigs: ServerGroup['nodeConfigs'] = {}, count = 16): ServerGroup {
  return {
    id: 'g',
    role: 'worker',
    modelId: 'server-microcloud-h13', // 8 nodes per chassis
    count,
    uplink: '2x25G',
    sizeId: 'n1-medium-x86',
    nodeConfigs,
  }
}

describe('nodeConfig', () => {
  it('falls back to the group configuration', () => {
    expect(nodeConfig(group(), 2)).toEqual({ sizeId: 'n1-medium-x86' })
  })

  it('returns a position entry over the group configuration', () => {
    const g = group({ 2: { sizeId: 'c1-medium-x86' } })
    expect(nodeConfig(g, 2).sizeId).toBe('c1-medium-x86')
    expect(nodeConfig(g, 1).sizeId).toBe('n1-medium-x86')
  })
})

describe('chassis position math', () => {
  it('caps positions at the chassis size and at the node count', () => {
    expect(chassisPositions(group())).toBe(8)
    expect(chassisPositions(group({}, 3))).toBe(3)
  })

  it('counts the nodes at a position across chassis', () => {
    // 12 nodes: a full chassis plus positions 1-4 of a second.
    expect(nodesAtPosition(group({}, 12), 0)).toBe(2)
    expect(nodesAtPosition(group({}, 12), 3)).toBe(2)
    expect(nodesAtPosition(group({}, 12), 4)).toBe(1)
    expect(nodesAtPosition(group({}, 12), 7)).toBe(1)
    expect(nodesAtPosition(group({}, 12), 8)).toBe(0)
  })
})

describe('configBuckets', () => {
  it('puts every position in the shared bucket without deviations', () => {
    expect(configBuckets(group())).toEqual([
      {
        config: { sizeId: 'n1-medium-x86' },
        positions: [0, 1, 2, 3, 4, 5, 6, 7],
        count: 16,
        custom: false,
      },
    ])
  })

  it('splits deviating positions into their own bucket, counting all chassis', () => {
    const buckets = configBuckets(group({ 2: { sizeId: 'c1-medium-x86' } }))
    expect(buckets).toHaveLength(2)
    expect(buckets[0]).toMatchObject({ count: 14, custom: false })
    expect(buckets[1]).toMatchObject({
      config: { sizeId: 'c1-medium-x86' },
      positions: [2],
      count: 2,
      custom: true,
    })
  })

  it('merges identical deviations into one bucket', () => {
    const buckets = configBuckets(
      group({ 1: { sizeId: 'c1-medium-x86' }, 3: { sizeId: 'c1-medium-x86' } }),
    )
    expect(buckets).toHaveLength(2)
    expect(buckets[1].positions).toEqual([1, 3])
    expect(buckets[1].count).toBe(4)
  })

  it('folds a deviation identical to the shared configuration back in', () => {
    const buckets = configBuckets(group({ 1: groupConfig(group()) }))
    expect(buckets).toHaveLength(1)
    expect(buckets[0].custom).toBe(false)
  })

  it('ignores entries at or above the chassis size', () => {
    const buckets = configBuckets(group({ 9: { sizeId: 'c1-medium-x86' } }))
    expect(buckets).toHaveLength(1)
  })
})

describe('positionListLabel', () => {
  it('names one position or several, 1-based', () => {
    expect(positionListLabel([2])).toBe('chassis position 3')
    expect(positionListLabel([0, 3])).toBe('chassis positions 1, 4')
  })
})
