import { describe, expect, it } from 'vitest'
import {
  createEmptyPlan,
  newRack,
  nextGroupName,
  nextRackNames,
  physicalRackNames,
  withRackKind,
} from './defaults'

function partition() {
  return createEmptyPlan().partitions[0]
}

describe('default rack names', () => {
  it('numbers every physical rack uniquely, a group taking three numbers', () => {
    const p = partition()
    p.racks.push(newRack(p, 'rack-group'))
    p.racks.push(newRack(p, 'single'))
    expect(p.racks.map((r) => r.name)).toEqual(['Rack 1', 'Rack group 1', 'Rack 5'])
    expect(physicalRackNames(p)).toEqual(['Rack 1', 'Rack 2', 'Rack 3', 'Rack 4', 'Rack 5'])
    expect(nextRackNames(p, 3)).toEqual(['Rack 6', 'Rack 7', 'Rack 8'])
    expect(nextGroupName(p)).toBe('Rack group 2')
  })

  it('continues above the highest number instead of reusing a gap', () => {
    const p = partition()
    p.racks.push(newRack(p, 'single'))
    p.racks.push(newRack(p, 'single'))
    p.racks.splice(1, 1) // remove Rack 2
    expect(nextRackNames(p, 1)).toEqual(['Rack 4'])
  })

  it('ignores custom names when numbering', () => {
    const p = partition()
    p.racks[0].name = 'GPU rack'
    expect(nextRackNames(p, 1)).toEqual(['Rack 1'])
  })
})

describe('withRackKind', () => {
  it('turns a single rack into a group and back without duplicating names', () => {
    const p = partition()
    p.racks.push(newRack(p, 'single')) // Rack 2
    const group = withRackKind(p, p.racks[0], 'rack-group')
    expect(group.name).toBe('Rack group 1')
    expect(group.memberNames).toEqual(['Rack 1', 'Rack 3', 'Rack 4'])

    p.racks[0] = group
    const single = withRackKind(p, group, 'single')
    expect(single.name).toBe('Rack 3') // the middle rack, which holds the switches
    expect(single.memberNames).toBeUndefined()
    expect(single.id).toBe(group.id)
  })

  it('leaves a rack of the requested kind unchanged', () => {
    const p = partition()
    expect(withRackKind(p, p.racks[0], 'single')).toBe(p.racks[0])
  })
})
