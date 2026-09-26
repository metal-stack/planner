import { describe, expect, it } from 'vitest'
import { createEmptyPlan, defaultRack } from '../model/defaults'
import type { Partition } from '../model/plan'
import { podsOf, spinesTotal, superspinesPerPlane } from './pods'

function superspinePartition(): Partition {
  const p = createEmptyPlan().partitions[0]
  p.fabric.fabricType = 'leaf-spine-superspine'
  p.fabric.spineCount = 2
  p.fabric.superspineCount = 4
  return p
}

describe('podsOf', () => {
  it('has no pods in a leaf-spine fabric', () => {
    const p = createEmptyPlan().partitions[0]
    p.pods = [{ id: 'a', name: 'A' }]
    expect(podsOf(p)).toEqual([])
  })

  it('puts every rack into an implicit Pod 1 when none is defined', () => {
    const p = superspinePartition()
    const pods = podsOf(p)
    expect(pods.map((x) => x.name)).toEqual(['Pod 1'])
    expect(pods[0].racks.map((r) => r.id)).toEqual(p.racks.map((r) => r.id))
  })

  it('assigns racks by podId, and racks with an unknown pod to the first', () => {
    const p = superspinePartition()
    p.pods = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]
    const r2 = { ...defaultRack('Rack 2'), podId: 'b' }
    const r3 = { ...defaultRack('Rack 3'), podId: 'gone' }
    p.racks.push(r2, r3)
    const pods = podsOf(p)
    expect(pods.map((x) => x.racks.map((r) => r.name))).toEqual([['Rack 1', 'Rack 3'], ['Rack 2']])
  })
})

describe('spine counts', () => {
  it('counts the border spines plus spineCount per pod', () => {
    const p = superspinePartition()
    p.pods = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]
    expect(spinesTotal(p)).toBe(2 * 3)
    const leafSpine = createEmptyPlan().partitions[0]
    expect(spinesTotal(leafSpine)).toBe(leafSpine.fabric.spineCount)
  })

  it('gives each plane superspineCount / spineCount superspines', () => {
    const p = superspinePartition()
    expect(superspinesPerPlane(p)).toBe(2)
    p.fabric.superspineCount = 5
    expect(superspinesPerPlane(p)).toBe(2)
    expect(superspinesPerPlane(createEmptyPlan().partitions[0])).toBe(0)
  })
})
