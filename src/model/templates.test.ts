import { describe, expect, it } from 'vitest'
import { deriveBom } from '../derive/bom'
import { planNodes } from '../derive/nodes'
import { validatePlan } from '../derive/validate'
import { catalog } from './catalog'
import { createEmptyPlan, physicalRackNames } from './defaults'
import { PlanSchema, type Plan } from './plan'
import { templates } from './templates'

describe('templates', () => {
  it.each(templates)('$name parses and validates without errors', (template) => {
    const plan = template.build()
    expect(PlanSchema.safeParse(plan).success).toBe(true)
    expect(validatePlan(plan).filter((i) => i.severity === 'error')).toEqual([])
  })

  it('builds fresh ids on every load', () => {
    const t = templates[0]
    expect(t.build().partitions[0].id).not.toBe(t.build().partitions[0].id)
  })

  it('starter: one partition, non-redundant mgmt, 8 workers on two leaves', () => {
    const plan = templates.find((t) => t.id === 'starter')!.build()
    expect(plan.partitions).toHaveLength(1)
    expect(plan.partitions[0].fabric.mgmt.redundant).toBe(false)
    expect(plan.partitions[0].racks[0].leafCount).toBe(2)
    expect(planNodes(plan)).toEqual({ total: 8, byRole: { worker: 8 } })
  })

  it('redundant: two rack groups with workers and three storage servers', () => {
    const plan = templates.find((t) => t.id === 'redundant')!.build()
    const [partition] = plan.partitions
    expect(partition.fabric.mgmt.redundant).toBe(true)
    expect(partition.racks.map((r) => r.kind)).toEqual(['rack-group', 'rack-group'])
    expect(physicalRackNames(partition)).toEqual([
      'Rack 1',
      'Rack 2',
      'Rack 3',
      'Rack 4',
      'Rack 5',
      'Rack 6',
    ])
    expect(planNodes(plan).byRole.storage).toBe(3)
  })

  it('three partitions: multisite with three redundant partitions', () => {
    const plan = templates.find((t) => t.id === 'three-partitions')!.build()
    expect(plan.topology).toBe('multisite')
    expect(plan.partitions).toHaveLength(3)
    expect(plan.partitions.every((p) => p.racks.length === 2)).toBe(true)
    expect(planNodes(plan).byRole.storage).toBe(9)
  })
})

describe('templates use current hardware', () => {
  /** Ids in a plan's BOM that are no longer orderable from the vendor.
   *  Nothing is exempt: with the NOS selectable and Broadcom Enterprise
   *  SONiC the default, a template can order a fully current BOM. */
  function staleHardware(plan: Plan): string[] {
    const ids = deriveBom(plan)
      .map((line) => line.catalogId.split('#')[0])
      .filter((id) => {
        const availability = catalog[id]?.availability
        return availability && availability !== 'current'
      })
    return [...new Set(ids)]
  }

  it.each(templates)('$name orders no end-of-life or withdrawn hardware', (template) => {
    expect(staleHardware(template.build())).toEqual([])
  })

  it('the default plan orders no end-of-life or withdrawn hardware', () => {
    expect(staleHardware(createEmptyPlan())).toEqual([])
  })

  it.each(templates)('$name runs Broadcom Enterprise SONiC', (template) => {
    const plan = template.build()
    expect(plan.partitions.map((p) => p.fabric.nos)).toEqual(
      plan.partitions.map(() => 'broadcom-sonic'),
    )
  })
})
