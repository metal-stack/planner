import { describe, expect, it } from 'vitest'
import { createEmptyPlan, defaultPartition } from '../model/defaults'
import type { Plan } from '../model/plan'
import {
  controlPlaneFootprint,
  controlPlaneHost,
  controlPlaneLeafCount,
  controlPlaneSwitchPorts,
  hasOnPremControlPlane,
  hasOwnRack,
  inCentralRack,
} from './controlPlane'

/** A plan with an on-prem control plane, `patch` applied on top. */
function onPrem(patch: Partial<Plan['controlPlane']> = {}): Plan {
  const plan = createEmptyPlan()
  plan.controlPlane = { ...plan.controlPlane, hosting: 'on-prem', ...patch }
  return plan
}

describe('controlPlane', () => {
  it('has no hardware for a managed cluster', () => {
    const plan = createEmptyPlan()
    expect(plan.controlPlane.hosting).toBe('kaas')
    expect(controlPlaneHost(plan)).toBeUndefined()
    expect(hasOnPremControlPlane(plan)).toBe(false)
    expect(inCentralRack(plan, plan.partitions[0])).toBe(false)
    expect(controlPlaneLeafCount(plan, plan.partitions[0])).toBe(0)
  })

  it('hosts on-prem nodes in the first partition unless one is chosen', () => {
    const plan = onPrem()
    plan.partitions.push(defaultPartition('Partition 2'))
    expect(controlPlaneHost(plan)?.id).toBe(plan.partitions[0].id)

    plan.controlPlane.partitionId = plan.partitions[1].id
    expect(controlPlaneHost(plan)?.id).toBe(plan.partitions[1].id)
    expect(inCentralRack(plan, plan.partitions[1])).toBe(true)
    expect(inCentralRack(plan, plan.partitions[0])).toBe(false)
  })

  it('falls back to the first partition when the chosen one is gone', () => {
    const plan = onPrem({ partitionId: 'removed' })
    expect(controlPlaneHost(plan)?.id).toBe(plan.partitions[0].id)
  })

  it('puts the leaves in the host partition only for an own rack', () => {
    const central = onPrem()
    expect(hasOwnRack(central, central.partitions[0])).toBe(false)
    expect(controlPlaneLeafCount(central, central.partitions[0])).toBe(0)

    const own = onPrem({ placement: 'own-rack' })
    expect(hasOwnRack(own, own.partitions[0])).toBe(true)
    expect(inCentralRack(own, own.partitions[0])).toBe(false)
    expect(controlPlaneLeafCount(own, own.partitions[0])).toBe(2)
  })

  it('counts switch ports as breakout groups at 25G and one to one at 100G', () => {
    // 3 nodes × 2 ports = 6 ports of 25G → 2 breakout groups of four.
    expect(controlPlaneSwitchPorts(onPrem().controlPlane)).toBe(2)
    expect(controlPlaneSwitchPorts(onPrem({ uplink: '2x100G' }).controlPlane)).toBe(6)
    expect(controlPlaneSwitchPorts(onPrem({ nodeCount: 2 }).controlPlane)).toBe(1)
  })

  it('sums height and power of the nodes', () => {
    // SYS-121H-TNR: 1U, 500 W each.
    expect(controlPlaneFootprint(onPrem().controlPlane)).toEqual({ units: 3, watts: 1500 })
    expect(controlPlaneFootprint(onPrem({ nodeCount: 0 }).controlPlane)).toEqual({
      units: 0,
      watts: 0,
    })
  })
})
