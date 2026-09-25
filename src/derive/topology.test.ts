import { describe, expect, it } from 'vitest'
import { createEmptyPlan, defaultPartition, withRackKind } from '../model/defaults'
import type { Plan } from '../model/plan'
import { CONTROL_PLANE_RACK_ID, deriveTopology, filterTopology } from './topology'

describe('deriveTopology', () => {
  it('derives the central rack and compute racks for the default plan', () => {
    const graph = deriveTopology(createEmptyPlan())
    const partition = graph.partitions[0]

    // Spines, exits, mgmt spines and mgmt servers live in the central rack.
    expect(partition.central.spines).toHaveLength(2)
    expect(partition.central.exits).toHaveLength(2)
    expect(partition.central.superspines).toHaveLength(0)
    expect(partition.central.mgmtSpines).toHaveLength(2) // redundant by default
    expect(partition.central.mgmtServers).toHaveLength(2)
    expect(partition.racks).toHaveLength(1)

    const rack = partition.racks[0]
    expect(rack.leaves).toHaveLength(2)
    // No OOB switch — the mgmt leaf carries BMC/OOB access.
    expect(rack.mgmtLeaves).toHaveLength(1)
  })

  it('halves mgmt spines and servers for a non-redundant management network', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].fabric.mgmt.redundant = false
    const graph = deriveTopology(plan)
    expect(graph.partitions[0].central.mgmtSpines).toHaveLength(1)
    expect(graph.partitions[0].central.mgmtServers).toHaveLength(1)
  })

  it('labels the mgmt spine with the management network layer', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].fabric.mgmt.layer = 'l2'
    const graph = deriveTopology(plan)
    expect(graph.partitions[0].central.mgmtSpines[0].sublabel).toContain('L2')
  })

  it('links every leaf to every spine on the production network', () => {
    const graph = deriveTopology(createEmptyPlan())
    const partition = graph.partitions[0]
    const leafSpine = graph.links.filter(
      (l) =>
        partition.racks[0].leaves.some((n) => n.id === l.from) &&
        partition.central.spines.some((n) => n.id === l.to),
    )
    expect(leafSpine).toHaveLength(4) // 2 leaves x 2 spines
    expect(leafSpine.every((l) => l.network === 'production' && l.speed === '100G')).toBe(true)
  })

  it('draws no edges from server groups', () => {
    const graph = deriveTopology(createEmptyPlan())
    const rack = graph.partitions[0].racks[0]
    const workers = rack.serverGroups.find((g) => g.label.includes('worker'))!
    expect(graph.links.filter((l) => l.from === workers.id || l.to === workers.id)).toHaveLength(0)
  })

  it('adds superspines and their spine links only for superspine fabrics', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].fabric.fabricType = 'leaf-spine-superspine'
    plan.partitions[0].fabric.superspineCount = 2
    const graph = deriveTopology(plan)
    const partition = graph.partitions[0]

    expect(partition.central.superspines).toHaveLength(2)
    const spineSuper = graph.links.filter((l) =>
      partition.central.superspines.some((n) => n.id === l.to),
    )
    expect(spineSuper).toHaveLength(4) // 2 spines x 2 superspines
  })

  it('attaches external networks at the routers, or the exits without routers', () => {
    const graph = deriveTopology(createEmptyPlan())
    const partition = graph.partitions[0]
    expect(partition.externalNetworks).toHaveLength(1)
    expect(partition.externalNetworks[0].networkKind).toBe('internet')
    const extLinks = graph.links.filter((l) => l.from === partition.externalNetworks[0].id)
    // With routers present the external network attaches at the routers.
    expect(partition.central.routers).toHaveLength(2)
    expect(extLinks.map((l) => l.to).sort()).toEqual(
      partition.central.routers.map((n) => n.id).sort(),
    )
    const routerExit = graph.links.filter(
      (l) =>
        partition.central.routers.some((n) => n.id === l.from) &&
        partition.central.exits.some((n) => n.id === l.to),
    )
    expect(routerExit).toHaveLength(4)
    expect(routerExit.every((l) => l.count === 2 && l.speed === '100G')).toBe(true)

    // Without routers it attaches directly at the exits.
    const noRouters = createEmptyPlan()
    noRouters.partitions[0].fabric.routerCount = 0
    const g2 = deriveTopology(noRouters)
    const ext2 = g2.links.filter((l) => l.from === g2.partitions[0].externalNetworks[0].id)
    expect(ext2.map((l) => l.to).sort()).toEqual(
      g2.partitions[0].central.exits.map((n) => n.id).sort(),
    )
    expect(extLinks.every((l) => l.network === 'external')).toBe(true)
  })

  it('derives storage leaves with spine links when configured', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].fabric.storageLeafCount = 2
    const graph = deriveTopology(plan)
    const partition = graph.partitions[0]
    expect(partition.storageLeaves).toHaveLength(2)
    const links = graph.links.filter((l) => partition.storageLeaves.some((n) => n.id === l.from))
    expect(links).toHaveLength(4) // 2 storage leaves x 2 spines
  })

  it('draws a rack group as three physical racks sharing the middle switches', () => {
    const plan = createEmptyPlan()
    const partition = plan.partitions[0]
    const rack = withRackKind(partition, partition.racks[0], 'rack-group')
    partition.racks = [rack]
    // 14 chassis x 3U spread evenly: 5 left, 4 mid (3U of switches), 5 right
    rack.servers[0].count = 14 * 8
    const graph = deriveTopology(plan)
    const racks = graph.partitions[0].racks

    expect(racks.map((r) => r.name)).toEqual(['Rack 1', 'Rack 2', 'Rack 3'])
    expect(racks[0].entity?.name).toBe('Rack group 1')
    expect(racks.map((r) => r.entity?.position)).toEqual(['left', 'mid', 'right'])
    const [left, mid, right] = racks
    expect(mid.leaves).toHaveLength(2)
    expect(mid.mgmtLeaves).toHaveLength(1)
    expect(left.leaves).toHaveLength(0)
    expect(mid.serverGroups[0].label).toBe('32 × worker')
    expect(left.serverGroups[0].label).toBe('40 × worker')
    expect(right.serverGroups[0].label).toBe('40 × worker')

    // The spilled group is a node in the left rack but, like every server
    // group, has no edges.
    const spilled = left.serverGroups[0]
    expect(graph.links.some((l) => l.from === spilled.id)).toBe(false)
  })

  it('keeps a single rack as one physical rack without an entity', () => {
    const graph = deriveTopology(createEmptyPlan())
    const rack = graph.partitions[0].racks[0]
    expect(rack.entity).toBeUndefined()
    expect(rack.name).toBe('Rack 1')
  })

  it('draws a network attached to every partition once per partition', () => {
    const plan = createEmptyPlan()
    plan.partitions.push({ ...plan.partitions[0], id: 'p2', name: 'P2' })
    const graph = deriveTopology(plan)
    expect(graph.partitions.map((p) => p.externalNetworks.length)).toEqual([1, 1])
    expect(graph.partitions[0].externalNetworks[0].id).not.toBe(
      graph.partitions[1].externalNetworks[0].id,
    )
  })
})

describe('filterTopology', () => {
  const kinds = (g: ReturnType<typeof deriveTopology>) =>
    new Set(
      g.partitions
        .flatMap((p) => [
          ...Object.values(p.central).flat(),
          ...p.storageLeaves,
          ...p.externalNetworks,
          ...p.racks.flatMap((r) => [...r.leaves, ...r.mgmtLeaves, ...r.serverGroups]),
        ])
        .map((n) => n.kind),
    )

  it('production mode drops management nodes and links', () => {
    const g = filterTopology(deriveTopology(createEmptyPlan()), 'production')
    const k = kinds(g)
    expect(k.has('mgmt-spine') || k.has('mgmt-leaf') || k.has('mgmt-server')).toBe(false)
    expect(k.has('spine') && k.has('leaf') && k.has('router')).toBe(true)
    expect(g.links.every((l) => l.network !== 'management')).toBe(true)
    expect(g.links.length).toBeGreaterThan(0)
  })

  it('management mode keeps only the management network', () => {
    const g = filterTopology(deriveTopology(createEmptyPlan()), 'management')
    const k = kinds(g)
    expect(k.has('spine') || k.has('exit') || k.has('router') || k.has('leaf')).toBe(false)
    expect(k.has('mgmt-spine') && k.has('mgmt-leaf') && k.has('mgmt-server')).toBe(true)
    expect(g.partitions[0].externalNetworks).toHaveLength(0)
    expect(g.links.every((l) => l.network === 'management')).toBe(true)
    expect(g.links.length).toBeGreaterThan(0)
  })

  it('central mode keeps the central rack with both networks and no compute racks', () => {
    const g = filterTopology(deriveTopology(createEmptyPlan()), 'central')
    expect(g.partitions[0].racks).toHaveLength(0)
    expect(g.partitions[0].central.spines).toHaveLength(2)
    expect(g.partitions[0].central.mgmtSpines).toHaveLength(2)
    expect(g.links.some((l) => l.network === 'management')).toBe(true)
    expect(g.links.some((l) => l.network === 'production')).toBe(true)
    // no dangling links to removed racks
    expect(g.links.every((l) => !l.to.includes('leaf') && !l.from.includes('leaf'))).toBe(true)
  })
})

describe('control plane in the topology', () => {
  function onPrem(patch: Partial<Plan['controlPlane']> = {}) {
    const plan = createEmptyPlan()
    plan.controlPlane = { ...plan.controlPlane, hosting: 'on-prem', ...patch }
    return plan
  }

  it('hangs a managed control plane off the routers of every partition', () => {
    const plan = createEmptyPlan()
    plan.partitions.push(defaultPartition('Partition 2'))
    const graph = deriveTopology(plan)
    for (const partition of graph.partitions) {
      const cp = partition.controlPlane!
      expect(cp.managed).toBe(true)
      expect(cp.node.kind).toBe('control-plane')
      const targets = graph.links.filter((l) => l.from === cp.node.id).map((l) => l.to)
      expect(targets.sort()).toEqual(partition.central.routers.map((n) => n.id).sort())
    }
    // Two partitions, two separate capsules.
    expect(graph.partitions[0].controlPlane!.node.id).not.toBe(
      graph.partitions[1].controlPlane!.node.id,
    )
  })

  it('links on-prem nodes in the central rack to the exits', () => {
    const graph = deriveTopology(onPrem())
    const partition = graph.partitions[0]
    const cp = partition.controlPlane!
    expect(cp.managed).toBe(false)
    expect(cp.node.sublabel).toBe('3 × SYS-121H-TNR')
    const links = graph.links.filter((l) => l.from === cp.node.id)
    expect(links.map((l) => l.to).sort()).toEqual(partition.central.exits.map((n) => n.id).sort())
    expect(links.every((l) => l.network === 'production' && l.speed === '25G')).toBe(true)
  })

  it('draws an own rack with leaves uplinked to the spines', () => {
    const graph = deriveTopology(onPrem({ placement: 'own-rack' }))
    const partition = graph.partitions[0]
    expect(partition.controlPlane).toBeUndefined()
    const rack = partition.racks.find((r) => r.id === CONTROL_PLANE_RACK_ID)!
    expect(rack.name).toBe('Control plane rack')
    expect(rack.leaves).toHaveLength(2)
    expect(rack.serverGroups[0].kind).toBe('control-plane')
    const uplinks = graph.links.filter((l) => rack.leaves.some((n) => n.id === l.from))
    expect(uplinks).toHaveLength(4) // 2 leaves × 2 spines
    const mgmt = graph.links.filter((l) => rack.mgmtLeaves.some((n) => n.id === l.from))
    expect(mgmt).toHaveLength(2) // 1 mgmt leaf × 2 mgmt spines
  })

  it('drops the control plane in management mode, keeps it in central mode', () => {
    const graph = deriveTopology(onPrem())
    expect(filterTopology(graph, 'management').partitions[0].controlPlane).toBeUndefined()
    expect(filterTopology(graph, 'central').partitions[0].controlPlane).toBeDefined()
    expect(filterTopology(graph, 'production').partitions[0].controlPlane).toBeDefined()
  })
})
