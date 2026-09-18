import { describe, expect, it } from 'vitest'
import { breakoutChildren, frontPanelIndex, sonicPortNames } from '../model/catalog'
import { createEmptyPlan, defaultRack } from '../model/defaults'
import type { Plan } from '../model/plan'
import { templates } from '../model/templates'
import { rackBmcPorts } from './bom'
import { deriveDevices, devicesOf } from './devices'
import { derivePorts } from './ports'
import { leafPortsNeeded } from './validate'

const ports = (plan: Plan) => derivePorts(plan, deriveDevices(plan))
const host = (plan: Plan, name: string) => ports(plan).get(`partition-1-${name}`)!

describe('SONiC port names', () => {
  it('follow the platform port maps', () => {
    expect(sonicPortNames('switch-as7726', '100G')!.slice(-2)).toEqual([
      'Ethernet120',
      'Ethernet124',
    ])
    expect(sonicPortNames('switch-as4630', '25G')).toEqual([
      'Ethernet48',
      'Ethernet49',
      'Ethernet50',
      'Ethernet51',
    ])
    expect(sonicPortNames('switch-as4630', '100G')).toEqual(['Ethernet52', 'Ethernet56'])
    expect(sonicPortNames('switch-as4625', '10G')).toBeNull()
  })

  it('number front panels across port groups and name breakout lanes', () => {
    expect(frontPanelIndex('switch-as7726', 'Ethernet0')).toBe(1)
    expect(frontPanelIndex('switch-as7726', 'Ethernet124')).toBe(32)
    expect(frontPanelIndex('switch-as4630', 'Ethernet48')).toBe(49)
    expect(frontPanelIndex('switch-as4630', 'Ethernet56')).toBe(54)
    expect(frontPanelIndex('switch-as4625', 'Ethernet0')).toBeNull()
    expect(breakoutChildren('Ethernet8', '4x25G')).toEqual([
      'Ethernet8',
      'Ethernet9',
      'Ethernet10',
      'Ethernet11',
    ])
  })
})

describe('switch ports', () => {
  it('breaks out server ports first and puts uplinks last on a leaf', () => {
    // 8 nodes with 2x25G on a leaf pair: 8 × 25G per leaf → two 4x25G ports.
    const leaf = host(createEmptyPlan(), 'r01leaf01')
    expect(leaf.breakouts).toEqual([
      { port: 'Ethernet0', frontPanel: 1, mode: '4x25G' },
      { port: 'Ethernet4', frontPanel: 2, mode: '4x25G' },
    ])
    expect(leaf.bgp).toEqual(['Ethernet120', 'Ethernet124'])
    expect(leaf.uplinks).toEqual(['Ethernet120', 'Ethernet124'])
    // Server ports per breakout lane with RS-FEC and MTU 9000, uplinks at 9216.
    const servers = leaf.ports.filter((p) => p.use === 'servers')
    expect(servers.map((p) => p.name)).toEqual([
      'Ethernet0',
      'Ethernet1',
      'Ethernet2',
      'Ethernet3',
      'Ethernet4',
      'Ethernet5',
      'Ethernet6',
      'Ethernet7',
    ])
    expect(servers[0]).toEqual({
      name: 'Ethernet0',
      speed: 25000,
      mtu: 9000,
      fec: 'rs',
      use: 'servers',
    })
    expect(leaf.ports.filter((p) => p.use === 'spines')).toEqual([
      { name: 'Ethernet120', speed: 100000, mtu: 9216, use: 'spines' },
      { name: 'Ethernet124', speed: 100000, mtu: 9216, use: 'spines' },
    ])
  })

  it('matches the leaf port budget of the validation for every template', () => {
    for (const t of templates) {
      const plan = t.build()
      const all = ports(plan)
      deriveDevices(plan).forEach((p, i) => {
        for (const rack of plan.partitions[i].racks) {
          const leaves = devicesOf(p, 'leaf').filter((d) => d.rack?.rackId === rack.id)
          const serverPorts = leaves.reduce((n, d) => n + all.get(d.hostname)!.breakouts.length, 0)
          const native = rack.servers
            .filter((g) => g.uplink === '2x100G')
            .reduce((n, g) => n + 2 * g.count, 0)
          // Per leaf rounding may add one breakout port per leaf.
          expect(serverPorts + native).toBeGreaterThanOrEqual(leafPortsNeeded(rack))
          expect(serverPorts + native).toBeLessThanOrEqual(leafPortsNeeded(rack) + leaves.length)
        }
      })
    }
  })

  it('lays out exits, spines and superspines', () => {
    const plan = createEmptyPlan()
    const exit = host(plan, 'exit01')
    // Two links per internet router first, spine uplinks last.
    expect(exit.ports.map((p) => [p.name, p.use])).toEqual([
      ['Ethernet0', 'internet routers'],
      ['Ethernet4', 'internet routers'],
      ['Ethernet8', 'internet routers'],
      ['Ethernet12', 'internet routers'],
      ['Ethernet120', 'spines'],
      ['Ethernet124', 'spines'],
    ])
    expect(exit.bgp).toEqual(['Ethernet120', 'Ethernet124'])
    // 2 leaves + 2 exits from the first port.
    expect(host(plan, 'spine01').bgp).toEqual(['Ethernet0', 'Ethernet4', 'Ethernet8', 'Ethernet12'])

    const fabric = plan.partitions[0].fabric
    fabric.leafSpineLinks = 2
    fabric.fabricType = 'leaf-spine-superspine'
    fabric.superspineCount = 2
    expect(host(plan, 'r01leaf01').uplinks).toHaveLength(4)
    const spine = host(plan, 'spine01').bgp!
    expect(spine[0]).toBe('Ethernet0')
    expect(spine.slice(-2)).toEqual(['Ethernet120', 'Ethernet124'])
    expect(host(plan, 'superspine01').bgp).toEqual(['Ethernet0', 'Ethernet4'])
  })

  it('lays out the management switches like the BOM cables them', () => {
    const plan = createEmptyPlan()
    const rack = plan.partitions[0].racks[0]
    const mgmtLeaf = host(plan, 'r01mgmtleaf')
    // BMCs and leaf mgmt interfaces on copper, uplinks on the last 25G ports.
    const copper = mgmtLeaf.ports.filter((p) => p.speed === 1000)
    expect(copper).toHaveLength(rackBmcPorts(rack) + rack.leafCount)
    expect(mgmtLeaf.bgp).toEqual(['Ethernet50', 'Ethernet51'])
    expect(mgmtLeaf.ports.at(-1)).toEqual({
      name: 'Ethernet51',
      speed: 25000,
      mtu: 9000,
      use: 'mgmt spines',
    })
    // Mgmt servers on the first copper ports, then half of the 6 central
    // mgmt interfaces (2 spines, 2 exits, 2 routers), the mgmt leaf on fiber.
    const spine = host(plan, 'mgmtspine01')
    expect(spine.bgp).toEqual(['Ethernet0', 'Ethernet1', 'Ethernet48'])
    expect(spine.ports.filter((p) => p.use === 'central mgmt interfaces')).toHaveLength(3)
  })

  it('keeps management ports but no BGP ports for an L2 management network', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].fabric.mgmt.layer = 'l2'
    expect(host(plan, 'r01mgmtleaf').bgp).toEqual([])
    expect(host(plan, 'r01mgmtleaf').ports.length).toBeGreaterThan(0)
    expect(host(plan, 'mgmtspine01').bgp).toEqual([])
  })

  it('explains what cannot be laid out', () => {
    const noMap = createEmptyPlan()
    noMap.partitions[0].fabric.mgmt.leafModelId = 'switch-as4625'
    expect(host(noMap, 'r01mgmtleaf')).toMatchObject({ bgp: null, breakouts: [], ports: [] })
    expect(host(noMap, 'r01mgmtleaf').reason).toContain('switch-as4625')

    const full = createEmptyPlan()
    full.partitions[0].racks = Array.from({ length: 16 }, (_, i) => defaultRack(`Rack ${i + 1}`))
    expect(host(full, 'spine01')).toMatchObject({ bgp: null })
    expect(host(full, 'spine01').reason).toContain('needs 34 100G ports, has 32')
  })

  it('never uses a port twice', () => {
    for (const t of templates) {
      for (const [name, sp] of ports(t.build())) {
        // A broken-out port's first lane keeps its name, so lanes and
        // ports are one list of interface names.
        const used = sp.ports.map((p) => p.name)
        expect(new Set(used).size, name).toBe(used.length)
        const parents = sp.breakouts.map((b) => b.port)
        expect(new Set(parents).size, name).toBe(parents.length)
      }
    }
  })
})
