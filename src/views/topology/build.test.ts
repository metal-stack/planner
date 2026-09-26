import { describe, expect, it } from 'vitest'
import { createEmptyPlan, defaultPartition, withRackKind } from '../../model/defaults'
import { CONTROL_PLANE_RACK_ID, deriveTopology } from '../../derive/topology'
import {
  modeShowing,
  nodeSelections,
  paletteAction,
  paletteState,
  resolveSelection,
  selectionAfter,
  type PaletteItemId,
} from './build'

describe('resolveSelection', () => {
  it('keeps a rack that still exists', () => {
    const plan = createEmptyPlan()
    const partitionId = plan.partitions[0].id
    const rackId = plan.partitions[0].racks[0].id
    expect(resolveSelection(plan, { partitionId, rackId })).toEqual({ partitionId, rackId })
  })

  it('falls back to the partition once the rack is gone', () => {
    const plan = createEmptyPlan()
    const partitionId = plan.partitions[0].id
    expect(resolveSelection(plan, { partitionId, rackId: 'gone' })).toEqual({ partitionId })
  })

  it('drops a selection whose partition is gone', () => {
    const plan = createEmptyPlan()
    expect(resolveSelection(plan, { partitionId: 'gone', rackId: 'gone' })).toBeUndefined()
  })

  it('maps the control-plane rack to the control plane section', () => {
    const plan = createEmptyPlan()
    const partitionId = plan.partitions[0].id
    expect(resolveSelection(plan, { partitionId, rackId: CONTROL_PLANE_RACK_ID })).toEqual({
      section: 'control-plane',
    })
  })
})

describe('paletteState', () => {
  it('adds racks to the selected partition, else to the first one', () => {
    const plan = createEmptyPlan()
    plan.partitions.push(defaultPartition('Partition 2'))
    const second = plan.partitions[1]
    expect(paletteState('rack', plan, { partitionId: second.id })).toEqual({
      enabled: true,
      hint: 'Adds to Partition 2',
    })
    expect(paletteState('rack', plan, undefined).hint).toBe(`Adds to ${plan.partitions[0].name}`)
  })

  it('needs a selected rack for a server group', () => {
    const plan = createEmptyPlan()
    const partition = plan.partitions[0]
    expect(paletteState('server-group', plan, { partitionId: partition.id })).toEqual({
      enabled: false,
      hint: 'Select a rack first',
    })
    expect(
      paletteState('server-group', plan, {
        partitionId: partition.id,
        rackId: partition.racks[0].id,
      }),
    ).toEqual({ enabled: true, hint: `Adds to ${partition.racks[0].name}` })
  })

  it('needs a partition for everything that lives in one', () => {
    const plan = createEmptyPlan()
    plan.partitions = []
    for (const id of ['rack', 'rack-group', 'spine', 'exit', 'router'] as PaletteItemId[]) {
      expect(paletteState(id, plan, undefined)).toEqual({
        enabled: false,
        hint: 'Add a partition first',
      })
    }
    expect(paletteState('partition', plan, undefined).enabled).toBe(true)
    expect(paletteState('external-network', plan, undefined).enabled).toBe(true)
  })
})

describe('paletteAction', () => {
  it('turns a tier item into a count increment on the fabric', () => {
    const plan = createEmptyPlan()
    const partition = plan.partitions[0]
    const sel = { partitionId: partition.id }
    expect(paletteAction('spine', plan, sel)).toEqual({
      type: 'patchFabric',
      partitionId: partition.id,
      patch: { spineCount: partition.fabric.spineCount + 1 },
    })
    expect(paletteAction('router', plan, sel)).toEqual({
      type: 'patchFabric',
      partitionId: partition.id,
      patch: { routerCount: partition.fabric.routerCount + 1 },
    })
  })

  it('adds a rack group as a rack of that kind', () => {
    const plan = createEmptyPlan()
    const partitionId = plan.partitions[0].id
    expect(paletteAction('rack-group', plan, { partitionId })).toEqual({
      type: 'addRack',
      partitionId,
      kind: 'rack-group',
    })
  })

  it('does nothing for a disabled item', () => {
    const plan = createEmptyPlan()
    expect(paletteAction('server-group', plan, undefined)).toBeUndefined()
  })
})

describe('selectionAfter', () => {
  it('selects the rack an add created', () => {
    const before = createEmptyPlan()
    const partitionId = before.partitions[0].id
    const after = structuredClone(before)
    after.partitions[0].racks.push({ ...after.partitions[0].racks[0], id: 'new-rack' })
    const action = { type: 'addRack', partitionId, kind: 'single' } as const
    expect(selectionAfter(action, before, after)).toEqual({ partitionId, rackId: 'new-rack' })
  })

  it('selects the partition an add created', () => {
    const before = createEmptyPlan()
    const after = structuredClone(before)
    after.partitions.push({ ...after.partitions[0], id: 'new-partition' })
    expect(selectionAfter({ type: 'addPartition' }, before, after)).toEqual({
      partitionId: 'new-partition',
    })
  })

  it('keeps the rack selected after adding a server group to it', () => {
    const plan = createEmptyPlan()
    const partitionId = plan.partitions[0].id
    const rackId = plan.partitions[0].racks[0].id
    const action = { type: 'addServerGroup', partitionId, rackId } as const
    expect(selectionAfter(action, plan, plan)).toEqual({ partitionId, rackId })
  })
})

describe('modeShowing', () => {
  it('switches to a mode that shows what was just added', () => {
    expect(modeShowing('rack', 'central')).toBe('production')
    expect(modeShowing('spine', 'management')).toBe('production')
    expect(modeShowing('external-network', 'management')).toBe('production')
    expect(modeShowing('spine', 'central')).toBe('central')
    expect(modeShowing('rack', 'management')).toBe('management')
    expect(modeShowing('partition', 'management')).toBe('management')
  })
})

describe('nodeSelections', () => {
  it('selects the central rack, the rack group entity, or a plan-level section', () => {
    const plan = createEmptyPlan()
    const partition = plan.partitions[0]
    partition.racks[0] = withRackKind(partition, partition.racks[0], 'rack-group')
    const rackId = partition.racks[0].id
    const graph = deriveTopology(plan)
    const p = graph.partitions[0]
    const sel = nodeSelections(graph)

    expect(sel.get(p.central.spines[0].id)).toEqual({ partitionId: partition.id })
    expect(sel.get(p.central.mgmtFirewalls[0].id)).toEqual({ partitionId: partition.id })
    const left = p.racks.find((r) => r.entity?.position === 'left')!
    expect(left.serverGroups.length).toBeGreaterThan(0)
    expect(sel.get(left.serverGroups[0].id)).toEqual({ partitionId: partition.id, rackId })
    const mid = p.racks.find((r) => r.entity?.position === 'mid')!
    expect(sel.get(mid.leaves[0].id)).toEqual({ partitionId: partition.id, rackId })
    expect(p.externalNetworks.length).toBeGreaterThan(0)
    expect(sel.get(p.externalNetworks[0].id)).toEqual({ section: 'networks' })
  })
})
