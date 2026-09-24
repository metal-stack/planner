import { describe, expect, it } from 'vitest'
import { createEmptyPlan } from '../model/defaults'
import { SCHEMA_VERSION } from '../model/migrate'
import { exportPlanJson, importPlanJson } from './json'

describe('plan JSON round-trip', () => {
  it('exports and re-imports a plan unchanged', () => {
    const plan = createEmptyPlan()
    expect(importPlanJson(exportPlanJson(plan))).toEqual(plan)
  })

  it('rejects non-JSON input with a readable error', () => {
    expect(() => importPlanJson('not json {')).toThrow('not valid JSON')
  })

  it('writes the current format version', () => {
    const file = JSON.parse(exportPlanJson(createEmptyPlan())) as { schemaVersion: number }
    expect(file.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('rejects JSON without a format version', () => {
    expect(() => importPlanJson('{"foo": 1}')).toThrow('no format version')
    expect(() => importPlanJson('[]')).toThrow('not a plan file')
  })

  it('rejects a file from a newer planner', () => {
    const newer = { ...createEmptyPlan(), schemaVersion: SCHEMA_VERSION + 1 }
    expect(() => importPlanJson(JSON.stringify(newer))).toThrow(
      `format version ${SCHEMA_VERSION + 1}, but this planner reads up to version ${SCHEMA_VERSION}`,
    )
  })

  it('rejects a file whose contents do not match the schema', () => {
    const broken = { ...createEmptyPlan(), partitions: 'nope' }
    expect(() => importPlanJson(JSON.stringify(broken))).toThrow('not a valid plan')
  })

  it('round-trips compute and NIC overrides', () => {
    const plan = createEmptyPlan()
    const group = plan.partitions[0].racks[0].servers[0]
    group.sizeId = 'c1-medium-x86'
    group.compute = {
      cpuModelId: 'cpu-epyc-4344p',
      dimmModelId: 'mem-ddr5u-32g',
      dimmsPerNode: 4,
    }
    group.nicModelId = 'nic-connectx5'
    expect(importPlanJson(exportPlanJson(plan))).toEqual(plan)
  })

  it('round-trips per-node configurations', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].racks[0].servers[0].nodeConfigs = {
      1: { sizeId: 'c1-medium-x86', nicModelId: 'nic-connectx5' },
      3: { sizeId: 'n1-medium-x86', gpu: { modelId: 'gpu-h100-pcie', perNode: 1 } },
      5: { sizeId: 'n1-medium-x86', drives: [{ modelId: 'drive-nvme-960', perNode: 2 }] },
    }
    expect(importPlanJson(exportPlanJson(plan))).toEqual(plan)
  })

  it('imports files written before per-node configurations with none', () => {
    const raw = JSON.parse(exportPlanJson(createEmptyPlan())) as {
      partitions: { racks: { servers: Record<string, unknown>[] }[] }[]
    }
    delete raw.partitions[0].racks[0].servers[0].nodeConfigs
    const imported = importPlanJson(JSON.stringify(raw))
    expect(imported.partitions[0].racks[0].servers[0].nodeConfigs).toEqual({})
  })
})

describe('plans from before node configuration', () => {
  it('defaults the size and leaves overrides absent', () => {
    const raw = JSON.parse(exportPlanJson(createEmptyPlan())) as {
      partitions: { racks: { servers: Record<string, unknown>[] }[] }[]
    }
    const group = raw.partitions[0].racks[0].servers[0]
    delete group.sizeId
    delete group.compute
    delete group.nicModelId
    const imported = importPlanJson(JSON.stringify(raw)).partitions[0].racks[0].servers[0]
    expect(imported.sizeId).toBe('n1-medium-x86')
    expect(imported.compute).toBeUndefined()
    expect(imported.nicModelId).toBeUndefined()
  })
})

describe('files with shapes from before the format version', () => {
  /** A plan as an early build wrote it: zones instead of partitions, a
   *  management server group, and none of the later fields. */
  function v1File(): string {
    const plan = createEmptyPlan()
    const raw = JSON.parse(exportPlanJson(plan)) as Record<string, unknown>
    raw.schemaVersion = 1
    raw.zones = raw.partitions
    delete raw.partitions
    const zones = raw.zones as { racks: { servers: unknown[] }[] }[]
    zones[0].racks[0].servers.push({
      id: 'legacy',
      role: 'management',
      modelId: 'server-mgmt',
      count: 2,
      uplink: '2x25G',
    })
    delete raw.ipPlan
    delete raw.sparesPerLine
    return JSON.stringify(raw)
  }

  it('converts zones, drops management groups and fills new fields', () => {
    const imported = importPlanJson(v1File())
    expect(imported.schemaVersion).toBe(SCHEMA_VERSION)
    expect(imported.partitions).toHaveLength(1)
    expect(imported.partitions[0].racks[0].servers.map((g) => g.role)).toEqual(['worker'])
    expect(imported.ipPlan.ipv4.projectCidr).toBe('10.0.0.0/8')
    expect(imported.sparesPerLine).toBe(2)
  })

  it('maps an external network pinned to a zone', () => {
    const raw = JSON.parse(v1File()) as Record<string, unknown>
    const zones = raw.zones as { id: string }[]
    raw.externalNetworks = [
      { id: 'n1', name: 'Internet', kind: 'internet', attachedZoneId: zones[0].id },
    ]
    const imported = importPlanJson(JSON.stringify(raw))
    expect(imported.externalNetworks[0].attachedPartitionId).toBe(imported.partitions[0].id)
  })
})

describe('legacy plan files', () => {
  it('imports a plan with the removed interconnect link counts', () => {
    const plan = createEmptyPlan()
    const raw = JSON.parse(exportPlanJson(plan)) as {
      partitions: { fabric: Record<string, unknown> }[]
    }
    delete raw.partitions[0].fabric.leafSpineLinks
    raw.partitions[0].fabric.interconnect = { leafToMgmtLeafLinks: 4, spineToMgmtSpineLinks: 2 }
    const imported = importPlanJson(JSON.stringify(raw))
    expect(imported.partitions[0].fabric.leafSpineLinks).toBe(1)
    expect('interconnect' in imported.partitions[0].fabric).toBe(false)
  })
})

describe('plans without an IP plan', () => {
  it('imports older files with the default IP plan', () => {
    const raw = JSON.parse(exportPlanJson(createEmptyPlan())) as Record<string, unknown>
    delete raw.ipPlan
    const imported = importPlanJson(JSON.stringify(raw))
    expect(imported.ipPlan.ipv4.projectCidr).toBe('10.0.0.0/8')
    expect(imported.ipPlan.ipv6.enabled).toBe(true)
  })

  it('imports files written before the NOS field, defaulting to Broadcom', () => {
    const raw = JSON.parse(exportPlanJson(createEmptyPlan())) as {
      partitions: { fabric: Record<string, unknown> }[]
    }
    delete raw.partitions[0].fabric.nos
    const imported = importPlanJson(JSON.stringify(raw))
    expect(imported.partitions[0].fabric.nos).toBe('broadcom-sonic')
  })

  it('imports files written before GPUs, leaving groups without one', () => {
    const raw = JSON.parse(exportPlanJson(createEmptyPlan())) as {
      partitions: { racks: { servers: Record<string, unknown>[] }[] }[]
    }
    expect(raw.partitions[0].racks[0].servers[0].gpu).toBeUndefined()
    const imported = importPlanJson(JSON.stringify(raw))
    expect(imported.partitions[0].racks[0].servers[0].gpu).toBeUndefined()
  })
})
