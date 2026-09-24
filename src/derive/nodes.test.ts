import { describe, expect, it } from 'vitest'
import { createEmptyPlan, defaultPartition } from '../model/defaults'
import { formatTally, planNodes, rackNodes } from './nodes'

describe('node tallies', () => {
  it('counts rack, partition, and setup totals by role', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].racks[0].servers.push({
      id: 's',
      role: 'storage',
      modelId: 'server-superserver-tn20',
      count: 4,
      uplink: '2x100G',
      sizeId: 'n1-medium-x86',
      nodeConfigs: {},
    })
    plan.partitions.push(defaultPartition('Partition 2'))

    expect(rackNodes(plan.partitions[0].racks[0])).toEqual({
      total: 12,
      byRole: { worker: 8, storage: 4 },
    })
    expect(planNodes(plan).total).toBe(20)
  })

  it('formats mixed and single-role tallies', () => {
    expect(formatTally({ total: 12, byRole: { worker: 8, storage: 4 } })).toBe(
      '12 nodes (8 worker, 4 storage)',
    )
    expect(formatTally({ total: 8, byRole: { worker: 8 } })).toBe('8 worker nodes')
  })
})
