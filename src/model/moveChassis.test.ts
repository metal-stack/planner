import { describe, expect, it } from 'vitest'
import { createEmptyPlan, defaultRack } from './defaults'
import { moveChassis, type MoveChassisArgs } from './moveChassis'
import type { Plan, ServerGroup } from './plan'

function fixture(): {
  plan: Plan
  args: MoveChassisArgs
  source: ServerGroup
  target: Plan['partitions'][number]['racks'][number]
} {
  const plan = createEmptyPlan()
  const partition = plan.partitions[0]
  const sourceRack = partition.racks[0]
  const target = defaultRack('Rack 2', 'single', partition.rackDefaults)
  target.servers = []
  partition.racks.push(target)
  const source = sourceRack.servers[0]
  return {
    plan,
    source,
    target,
    args: {
      partitionId: partition.id,
      fromRackId: sourceRack.id,
      groupId: source.id,
      nodes: 3,
      toRackId: target.id,
    },
  }
}

describe('moveChassis', () => {
  it('creates a fresh group with the source attributes and reduces the source', () => {
    const { plan, args, source, target } = fixture()
    source.count = 8
    source.gpu = { modelId: 'gpu-l40s', perNode: 2 }

    const moved = moveChassis(plan, args)!
    const movedSource = moved.partitions[0].racks[0].servers[0]
    const movedTarget = moved.partitions[0].racks.find((rack) => rack.id === target.id)!.servers[0]

    expect(movedSource.count).toBe(5)
    expect(movedTarget).toMatchObject({
      modelId: source.modelId,
      role: source.role,
      uplink: source.uplink,
      gpu: source.gpu,
      count: 3,
    })
    expect(movedTarget.id).not.toBe(source.id)
  })

  it('merges into the first group with identical attributes', () => {
    const { plan, args, source, target } = fixture()
    const targetGroup = { ...source, id: crypto.randomUUID(), count: 6 }
    target.servers.push(targetGroup)

    const moved = moveChassis(plan, args)!
    const targetServers = moved.partitions[0].racks[1].servers

    expect(targetServers).toHaveLength(1)
    expect(targetServers[0]).toMatchObject({ id: targetGroup.id, count: 9 })
  })

  it('does not merge groups with different GPU attributes and copies GPU values', () => {
    const withoutGpu = fixture()
    withoutGpu.source.gpu = { modelId: 'gpu-l40s', perNode: 2 }
    withoutGpu.target.servers.push({
      ...withoutGpu.source,
      id: crypto.randomUUID(),
      count: 4,
      gpu: undefined,
    })

    const firstMove = moveChassis(withoutGpu.plan, withoutGpu.args)!
    const created = firstMove.partitions[0].racks[1].servers[1]
    expect(firstMove.partitions[0].racks[1].servers).toHaveLength(2)
    expect(created.gpu).toEqual(withoutGpu.source.gpu)
    expect(created.gpu).not.toBe(withoutGpu.source.gpu)

    const differentCount = fixture()
    differentCount.source.gpu = { modelId: 'gpu-l40s', perNode: 2 }
    differentCount.target.servers.push({
      ...differentCount.source,
      id: crypto.randomUUID(),
      count: 4,
      gpu: { modelId: 'gpu-l40s', perNode: 1 },
    })

    const secondMove = moveChassis(differentCount.plan, differentCount.args)!
    expect(secondMove.partitions[0].racks[1].servers).toHaveLength(2)
  })

  it('removes a source group when all of its nodes move', () => {
    const { plan, args, source } = fixture()
    source.count = 8

    const moved = moveChassis(plan, { ...args, nodes: 8 })!

    expect(moved.partitions[0].racks[0].servers).toHaveLength(0)
    expect(moved.partitions[0].racks[1].servers[0].count).toBe(8)
  })

  it('keeps other zero-node groups in the source rack', () => {
    const { plan, args, source } = fixture()
    source.count = 8
    const empty: ServerGroup = { ...source, id: crypto.randomUUID(), count: 0, uplink: '2x100G' }
    plan.partitions[0].racks[0].servers.push(empty)

    const moved = moveChassis(plan, { ...args, nodes: 8 })!
    const sourceServers = moved.partitions[0].racks[0].servers

    expect(sourceServers).toHaveLength(1)
    expect(sourceServers[0].id).toBe(empty.id)
  })

  it('returns null for a same-rack move', () => {
    const { plan, args } = fixture()
    expect(moveChassis(plan, { ...args, toRackId: args.fromRackId })).toBeNull()
  })

  it('moves the actual node count of a partial chassis', () => {
    const { plan, args, source } = fixture()
    source.count = 11

    const moved = moveChassis(plan, { ...args, nodes: 3 })!

    expect(moved.partitions[0].racks[0].servers[0].count).toBe(8)
    expect(moved.partitions[0].racks[1].servers[0].count).toBe(3)
  })

  it('returns null for unknown ids and invalid node counts', () => {
    const { plan, args, source } = fixture()
    const invalidArgs: MoveChassisArgs[] = [
      { ...args, partitionId: 'unknown' },
      { ...args, fromRackId: 'unknown' },
      { ...args, toRackId: 'unknown' },
      { ...args, groupId: 'unknown' },
      { ...args, nodes: 0 },
      { ...args, nodes: source.count + 1 },
    ]

    for (const invalid of invalidArgs) expect(moveChassis(plan, invalid)).toBeNull()
  })

  it('does not mutate its input and preserves uninvolved rack references', () => {
    const { plan, args } = fixture()
    const partition = plan.partitions[0]
    const uninvolved = defaultRack('Rack 3', 'single', partition.rackDefaults)
    partition.racks.push(uninvolved)
    const snapshot = structuredClone(plan)

    const moved = moveChassis(plan, args)!

    expect(plan).toEqual(snapshot)
    expect(moved).not.toBe(plan)
    expect(moved.partitions[0].racks[2]).toBe(uninvolved)
  })
})
