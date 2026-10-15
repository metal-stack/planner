import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createEmptyPlan } from '../../model/defaults'
import { exportPlanJson, importPlanJson } from '../../io/json'
import { validatePlan } from '../../derive/validate'
import type { Plan } from '../../model/plan'
import RackSection from './RackSection'

function renderImportedRack(plan: Plan) {
  const imported = importPlanJson(exportPlanJson(plan))
  const partition = imported.partitions[0]
  const issues = validatePlan(imported)
  return {
    messages: issues.map((issue) => issue.message),
    html: renderToStaticMarkup(
      <RackSection partition={partition} rack={partition.racks[0]} issues={issues} />,
    ),
  }
}

describe('imported server configurations', () => {
  it('edits the effective single-node configuration without a position selector', () => {
    const plan = createEmptyPlan()
    const group = plan.partitions[0].racks[0].servers[0]
    group.modelId = 'server-superserver-tn12'
    group.nodeConfigs = { 0: { sizeId: group.sizeId, compute: { cpuModelId: 'cpu-foo' } } }
    const { html } = renderImportedRack(plan)
    expect(html).not.toContain('All nodes')
    expect(html).not.toContain('Configure all nodes')
    expect(html).not.toContain('Reset chassis position')
    expect(html).not.toContain('Selecting a number above')
    expect(html).toContain('<option value="cpu-foo" selected="">cpu-foo (incompatible)</option>')
  })

  it('renders an unknown CPU with its validation error and a selected replacement option', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].racks[0].servers[0].compute = { cpuModelId: 'cpu-foo' }
    const { html, messages } = renderImportedRack(plan)
    expect(messages).toContain('Unknown CPU model "cpu-foo".')
    expect(html).toContain('<option value="cpu-foo" selected="">cpu-foo (incompatible)</option>')
  })

  it('keeps an incompatible imported SIOM NIC visible', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].racks[0].servers[0].nicModelId = 'nic-aoc-mh25g'
    const { html, messages } = renderImportedRack(plan)
    expect(messages.some((message) => message.includes('requires a SIOM slot'))).toBe(true)
    expect(html).toContain(
      '<option value="nic-aoc-mh25g" selected="">AOC-MH25G-m2S2T (incompatible)</option>',
    )
  })

  it('does not mark an explicitly selected default NIC as incompatible', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].racks[0].servers[0].nicModelId = 'nic-e810-xxvda2'
    expect(renderImportedRack(plan).html).toContain(
      '<option value="nic-e810-xxvda2" selected="">E810-XXVDA2</option>',
    )
  })
})
