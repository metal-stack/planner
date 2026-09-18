import { describe, expect, it } from 'vitest'
import { sonicPortNames } from '../model/catalog'
import { createEmptyPlan, defaultRack } from '../model/defaults'
import type { Plan } from '../model/plan'
import { deriveDevices } from './devices'
import { derivePorts } from './ports'

const ports = (plan: Plan) => derivePorts(plan, deriveDevices(plan))
const host = (plan: Plan, name: string) => ports(plan).get(`partition-1-${name}`)

describe('switch ports', () => {
  it('names SONiC ports after the platform port maps', () => {
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

  it('puts uplinks on the last ports and downlinks on the first', () => {
    const plan = createEmptyPlan()
    // One link per leaf and spine: the spine uplinks of the reference deployment.
    expect(host(plan, 'r01leaf01')).toEqual({
      bgp: ['Ethernet120', 'Ethernet124'],
      uplinks: ['Ethernet120', 'Ethernet124'],
    })
    expect(host(plan, 'exit01')!.bgp).toEqual(['Ethernet120', 'Ethernet124'])
    // 2 leaves + 2 exits from the first port.
    expect(host(plan, 'spine01')!.bgp).toEqual([
      'Ethernet0',
      'Ethernet4',
      'Ethernet8',
      'Ethernet12',
    ])
    // L3 management over 25G: mgmt leaf uplinks last, mgmt servers on copper.
    expect(host(plan, 'r01mgmtleaf')!.bgp).toEqual(['Ethernet50', 'Ethernet51'])
    expect(host(plan, 'mgmtspine01')!.bgp).toEqual(['Ethernet0', 'Ethernet1', 'Ethernet48'])
  })

  it('follows the number of leaf to spine links and superspines', () => {
    const plan = createEmptyPlan()
    const fabric = plan.partitions[0].fabric
    fabric.leafSpineLinks = 2
    fabric.fabricType = 'leaf-spine-superspine'
    fabric.superspineCount = 2
    expect(host(plan, 'r01leaf01')!.uplinks).toHaveLength(4)
    const spine = host(plan, 'spine01')!.bgp!
    expect(spine.slice(0, 1)).toEqual(['Ethernet0'])
    expect(spine.slice(-2)).toEqual(['Ethernet120', 'Ethernet124'])
    expect(host(plan, 'superspine01')!.bgp).toEqual(['Ethernet0', 'Ethernet4'])
  })

  it('leaves ports open without a port map or with too few ports', () => {
    const noMap = createEmptyPlan()
    noMap.partitions[0].fabric.mgmt.leafModelId = 'switch-as4625'
    expect(host(noMap, 'r01mgmtleaf')).toMatchObject({ bgp: null })
    expect(host(noMap, 'r01mgmtleaf')!.reason).toContain('switch-as4625')

    const full = createEmptyPlan()
    full.partitions[0].racks = Array.from({ length: 16 }, (_, i) => defaultRack(`Rack ${i + 1}`))
    expect(host(full, 'spine01')).toMatchObject({ bgp: null })
    expect(host(full, 'spine01')!.reason).toContain('needs 34 100G ports, has 32')
  })

  it('assigns no management BGP ports for an L2 management network', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].fabric.mgmt.layer = 'l2'
    expect(host(plan, 'r01mgmtleaf')).toBeUndefined()
    expect(host(plan, 'mgmtspine01')).toBeUndefined()
  })
})
