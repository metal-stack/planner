import { describe, expect, it } from 'vitest'
import { createEmptyPlan, defaultRack, withRackKind } from '../model/defaults'
import type { Plan } from '../model/plan'
import {
  countIssues,
  issuesFor,
  leafPortsAvailable,
  leafPortsNeeded,
  validatePlan,
} from './validate'

function basePlan(): Plan {
  return createEmptyPlan()
}

function errors(plan: Plan): string[] {
  return validatePlan(plan)
    .filter((i) => i.severity === 'error')
    .map((i) => i.message)
}

describe('leaf port capacity', () => {
  it('computes available ports: leaves x 100G ports - spine uplinks', () => {
    const plan = basePlan()
    const partition = plan.partitions[0]
    // 2 leaves x 32 ports - 2x2 spine uplinks = 60; the leaf<->mgmt link
    // uses the dedicated OOB mgmt port, not front-panel ports.
    expect(leafPortsAvailable(partition.racks[0], partition)).toBe(60)
    // Two links per leaf-spine pair double the uplinks: 64 - 8 = 56
    partition.fabric.leafSpineLinks = 2
    expect(leafPortsAvailable(partition.racks[0], partition)).toBe(56)
  })

  it('computes needed ports with breakout math', () => {
    const rack = defaultRack('r')
    rack.servers = [
      { id: 'a', role: 'worker', modelId: 'server-microcloud-x11', count: 30, uplink: '2x25G' },
      { id: 'b', role: 'worker', modelId: 'server-bigtwin-x11', count: 2, uplink: '2x100G' },
    ]
    // 30 nodes x 2 = 60 x25G -> ceil(60/4)=15 ports; 2 nodes x 2 = 4 x100G ports
    expect(leafPortsNeeded(rack)).toBe(19)
  })

  it('flags a rack that exceeds leaf capacity', () => {
    const plan = basePlan()
    // 120 x 2x100G nodes need 240 ports; 2x AS7726 provide 56 after uplinks
    plan.partitions[0].racks[0].servers = [
      { id: 'a', role: 'worker', modelId: 'server-bigtwin-x11', count: 120, uplink: '2x100G' },
    ]
    expect(errors(plan).some((m) => m.includes('Leaf capacity exceeded'))).toBe(true)
  })

  it('accepts a rack within leaf capacity', () => {
    expect(errors(basePlan())).toEqual([])
  })
})

describe('compatibility list', () => {
  it('rejects a management-only switch as leaf', () => {
    const plan = basePlan()
    plan.partitions[0].racks[0].leafModelId = 'switch-as4630'
    expect(errors(plan).some((m) => m.includes('not on the metal-stack compatibility list'))).toBe(
      true,
    )
  })

  it('rejects a management server as worker', () => {
    const plan = basePlan()
    plan.partitions[0].racks[0].servers[0].modelId = 'server-mgmt'
    expect(errors(plan).some((m) => m.includes('compatibility list for worker usage'))).toBe(true)
  })

  it('warns on alpha-status hardware', () => {
    const plan = basePlan()
    plan.partitions[0].racks[0].servers[0].modelId = 'server-lenovo-sd530'
    const warnings = validatePlan(plan).filter((i) => i.severity === 'warning')
    expect(warnings.some((i) => i.message.includes('alpha'))).toBe(true)
  })
})

describe('fabric type', () => {
  it('requires superspines when fabric type is leaf-spine-superspine', () => {
    const plan = basePlan()
    plan.partitions[0].fabric.fabricType = 'leaf-spine-superspine'
    plan.partitions[0].fabric.superspineCount = 0
    expect(errors(plan).some((m) => m.includes('superspine count is 0'))).toBe(true)
  })

  it('warns when superspines are set on a plain leaf-spine fabric', () => {
    const plan = basePlan()
    plan.partitions[0].fabric.superspineCount = 2
    const warnings = validatePlan(plan).filter((i) => i.severity === 'warning')
    expect(warnings.some((i) => i.message.includes('ignored'))).toBe(true)
  })
})

describe('spine capacity', () => {
  it('flags spines with more adjacencies than 100G ports', () => {
    const plan = basePlan()
    const zone = plan.partitions[0]
    // 20 racks x 2 leaves + 4 storage leaves + 2 exits = 46 > 32 ports
    zone.racks = Array.from({ length: 20 }, (_, i) => defaultRack(`Rack ${i + 1}`))
    zone.fabric.storageLeafCount = 4
    expect(errors(plan).some((m) => m.includes('Spine capacity exceeded'))).toBe(true)
  })
})

describe('issue targets', () => {
  it('points rack issues at their partition and rack', () => {
    const plan = basePlan()
    const partition = plan.partitions[0]
    const rack = partition.racks[0]
    rack.leafCount = 1
    const issues = validatePlan(plan)
    const rackIssues = issuesFor(issues, { partitionId: partition.id, rackId: rack.id })
    expect(rackIssues.map((i) => i.message)).toContain(
      'Only one leaf switch — no rack-level network redundancy.',
    )
    expect(rackIssues.every((i) => i.where === `${partition.name} / ${rack.name}`)).toBe(true)
  })

  it('keeps partition-level issues separate from rack issues', () => {
    const plan = basePlan()
    const partition = plan.partitions[0]
    partition.fabric.spineCount = 1
    const issues = validatePlan(plan)
    const fabricIssues = issuesFor(issues, { partitionId: partition.id })
    expect(fabricIssues.some((i) => i.message.includes('Only one spine'))).toBe(true)
    expect(fabricIssues.every((i) => i.target.rackId === undefined)).toBe(true)
  })

  it('counts by severity', () => {
    expect(
      countIssues([
        { severity: 'error', where: '', message: '', target: {} },
        { severity: 'warning', where: '', message: '', target: {} },
        { severity: 'warning', where: '', message: '', target: {} },
      ]),
    ).toEqual({ errors: 1, warnings: 2 })
  })
})

describe('mgmt spine port budget', () => {
  it('accepts the default plan and warns when mgmt leaves outnumber fiber ports', () => {
    const plan = basePlan()
    const partition = plan.partitions[0]
    expect(validatePlan(plan).some((i) => i.message.includes('Mgmt spine'))).toBe(false)
    // AS4630 has 4x 25G: five racks -> five mgmt leaf uplinks per mgmt spine
    for (let i = 0; i < 4; i++) partition.racks.push(defaultRack(`r${i}`))
    const issue = validatePlan(plan).find((i) => i.message.includes('Mgmt spine fiber ports'))
    expect(issue?.severity).toBe('warning')
  })
})

describe('mgmt leaf port budget', () => {
  it('flags more chassis than the mgmt leaf has 1G ports for', () => {
    const plan = basePlan()
    const rack = plan.partitions[0].racks[0]
    rack.leafCount = 4 // enough leaf ports so only the mgmt leaf overflows
    // 47 MicroCloud chassis + 2 leaf mgmt interfaces = 49 > 48 ports of one AS4630
    rack.servers[0].count = 47 * 8
    const issue = validatePlan(plan).find((i) => i.message.includes('Mgmt leaf capacity'))
    expect(issue?.severity).toBe('error')
    // A second mgmt leaf per rack fixes it.
    plan.partitions[0].fabric.mgmt.leafPerRack = 2
    expect(validatePlan(plan).some((i) => i.message.includes('Mgmt leaf capacity'))).toBe(false)
  })
})

describe('exit switch port budget', () => {
  it('flags more spine and router links than an exit has 100G ports', () => {
    const plan = basePlan()
    expect(validatePlan(plan).some((i) => i.message.includes('Exit switch capacity'))).toBe(false)
    // AS7726 has 32x 100G: 2 spines + 2 x 16 routers = 34
    plan.partitions[0].fabric.routerCount = 16
    const issue = validatePlan(plan).find((i) => i.message.includes('Exit switch capacity'))
    expect(issue?.severity).toBe('error')
  })
})

describe('rack power budget', () => {
  it('reports an error at the rack when the estimated draw exceeds its budget', () => {
    const plan = basePlan()
    const rack = plan.partitions[0].racks[0]
    rack.leafCount = 4
    rack.servers[0].count = 8 * 8 // 8 MicroClouds ≈ 16 kW + switches
    const issue = validatePlan(plan).find((i) => i.message.includes('Rack power budget'))
    expect(issue?.severity).toBe('error')
    expect(issue?.target).toEqual({
      partitionId: plan.partitions[0].id,
      rackId: rack.id,
      field: 'advanced',
    })
    rack.maxPowerWatts = 20000
    expect(validatePlan(plan).some((i) => i.message.includes('Rack power budget'))).toBe(false)
  })
})

describe('non-blocking fabric', () => {
  it('is only checked when the partition requires it', () => {
    const plan = basePlan()
    const partition = plan.partitions[0]
    partition.racks[0].servers[0].count = 16 // 800 Gbit/s behind 400
    expect(errors(plan).some((m) => m.includes('oversubscribed'))).toBe(false)

    partition.fabric.nonBlocking = true
    const issue = validatePlan(plan).find((i) => i.message.includes('oversubscribed'))
    expect(issue?.severity).toBe('error')
    expect(issue?.message).toContain('2.0 : 1')
    expect(issue?.message).toContain('needs 2 links per leaf ↔ spine pair (now 1)')
    expect(issue?.target).toEqual({ partitionId: partition.id, rackId: partition.racks[0].id })
  })

  it('clears once the leaf ↔ spine bundle is large enough', () => {
    const plan = basePlan()
    const partition = plan.partitions[0]
    partition.fabric.nonBlocking = true
    partition.racks[0].servers[0].count = 16
    partition.fabric.leafSpineLinks = 2
    expect(errors(plan).some((m) => m.includes('oversubscribed'))).toBe(false)
  })

  it('checks the spine tier when superspines are configured', () => {
    const plan = basePlan()
    const partition = plan.partitions[0]
    partition.fabric.nonBlocking = true
    partition.fabric.fabricType = 'leaf-spine-superspine'
    partition.fabric.superspineCount = 1 // 2 leaves x 100 down, 100 up
    const issue = validatePlan(plan).find((i) => i.message.includes('Spine tier is oversubscribed'))
    expect(issue?.message).toContain('needs 2 superspines (now 1)')
    partition.fabric.superspineCount = 2
    expect(errors(plan).some((m) => m.includes('Spine tier'))).toBe(false)
  })
})

describe('validatePlan GPUs and vendor availability', () => {
  function planWithGpu(modelId: string, perNode: number, serverModelId: string): Plan {
    const plan = createEmptyPlan()
    const rack = plan.partitions[0].racks[0]
    rack.servers = [
      {
        id: 'g1',
        role: 'worker',
        modelId: serverModelId,
        count: 8,
        uplink: '2x25G',
        gpu: { modelId, perNode },
      },
    ]
    return plan
  }

  it('accepts a GPU within the per-node limit', () => {
    const issues = validatePlan(planWithGpu('gpu-rtx-6000-ada', 1, 'server-microcloud-x13'))
    expect(issues.filter((i) => i.message.includes('GPU'))).toEqual([])
  })

  it('rejects more GPUs than a node accepts', () => {
    const issues = validatePlan(planWithGpu('gpu-rtx-6000-ada', 2, 'server-microcloud-x13'))
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('1 GPU per node'))).toBe(
      true,
    )
  })

  it('rejects GPUs on a server model that takes none', () => {
    const issues = validatePlan(planWithGpu('gpu-rtx-6000-ada', 1, 'server-bigtwin-x11'))
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('takes no GPUs'))).toBe(
      true,
    )
  })

  it('rejects an unknown GPU model', () => {
    const issues = validatePlan(planWithGpu('gpu-nope', 1, 'server-microcloud-x13'))
    expect(issues.some((i) => i.message.includes('Unknown GPU model'))).toBe(true)
  })

  /** Warnings about models that are no longer orderable. */
  function staleWarnings(plan: Plan) {
    return validatePlan(plan).filter((i) => i.message.includes('no longer be orderable'))
  }

  it('warns once per end-of-life item, however many the plan orders', () => {
    // Deliberately stale: the X11 MicroCloud in two racks and AS7712 spines.
    const plan = createEmptyPlan()
    const partition = plan.partitions[0]
    partition.fabric.spineModelId = 'switch-as7712'
    partition.racks[0].servers[0].modelId = 'server-microcloud-x11'
    partition.racks.push({
      ...structuredClone(partition.racks[0]),
      id: 'rack-2',
      name: 'Rack 2',
    })

    const issues = staleWarnings(plan)
    const models = issues.map((i) => i.message.split(' ')[0])
    // One per distinct model, not one per rack or per switch.
    expect(new Set(models).size).toBe(models.length)
    expect(models).toContain('SYS-5039MD8-H8TNR')
    expect(models).toContain('AS7712-32X')
    expect(issues.every((i) => i.severity === 'warning')).toBe(true)
  })

  it('warns about nothing for a default plan', () => {
    // Everything a default plan orders is current at the vendor, including
    // the NOS licenses now that Broadcom Enterprise SONiC is the default.
    expect(staleWarnings(createEmptyPlan())).toEqual([])
  })

  it('warns about the license set once a partition picks Edgecore SONiC', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].fabric.nos = 'edgecore-sonic'
    expect(
      staleWarnings(plan)
        .map((i) => i.message.split(' ')[0])
        .sort(),
    ).toEqual(['S-ECSONIC-10-25G-3Y', 'S-ECSONIC-40-100G-3Y'])
  })
})

describe('rack names', () => {
  it('warns when two physical racks share a name', () => {
    const plan = basePlan()
    const partition = plan.partitions[0]
    expect(validatePlan(plan).some((i) => i.message.includes('used more than once'))).toBe(false)
    partition.racks.push(defaultRack('Rack 1'))
    const dupes = validatePlan(plan).filter((i) => i.message.includes('used more than once'))
    expect(dupes).toHaveLength(1)
    expect(dupes[0].severity).toBe('warning')
  })
})

describe('issues fixed in the Advanced section', () => {
  const advanced = (plan: Plan) =>
    validatePlan(plan)
      .filter((i) => i.target.field === 'advanced')
      .map((i) => i.message)

  it("points height and power issues into the rack's Advanced section", () => {
    const plan = basePlan()
    const rack = plan.partitions[0].racks[0]
    rack.heightUnits = 4
    rack.maxPowerWatts = 1000
    const messages = advanced(plan)
    expect(messages.some((m) => m.startsWith('Rack height exceeded'))).toBe(true)
    expect(messages.some((m) => m.startsWith('Rack power budget exceeded'))).toBe(true)
  })

  it("points duplicate member names there, but not a single rack's name", () => {
    const plan = basePlan()
    const partition = plan.partitions[0]
    partition.racks.push(defaultRack('Rack 1'))
    expect(advanced(plan)).toEqual([])

    partition.racks[1] = withRackKind(partition, partition.racks[1], 'rack-group')
    // The group's left rack is now "Rack 1", clashing with the single rack.
    expect(advanced(plan).some((m) => m.includes('used more than once'))).toBe(true)
  })

  it("points the central rack's model issues there, but not its count issues", () => {
    const plan = basePlan()
    const partition = plan.partitions[0]
    partition.fabric.spineModelId = 'switch-as4630' // management-only switch
    partition.fabric.spineCount = 1
    partition.fabric.mgmt.serverModelId = 'server-microcloud-h13'
    const central = validatePlan(plan).filter((i) => !i.target.rackId)
    const inAdvanced = central.filter((i) => i.target.field === 'advanced').map((i) => i.message)
    expect(inAdvanced.some((m) => m.startsWith('Spine switch:'))).toBe(true)
    expect(inAdvanced.some((m) => m.startsWith('Mgmt server:'))).toBe(true)
    const single = central.find((i) => i.message.startsWith('Only one spine'))
    expect(single?.target.field).toBeUndefined()
  })

  it('leaves the leaf-port capacity error in the visible section', () => {
    const plan = basePlan()
    plan.partitions[0].racks[0].servers[0].count = 400
    const capacity = validatePlan(plan).find((i) => i.message.includes('leaf'))
    expect(capacity).toBeDefined()
    expect(capacity!.target.field).toBeUndefined()
  })
})
