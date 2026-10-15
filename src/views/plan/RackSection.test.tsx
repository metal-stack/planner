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
  it('renders an unknown CPU with its validation error and a selected replacement option', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].racks[0].servers[0].compute = { cpuModelId: 'cpu-foo' }
    const { html, messages } = renderImportedRack(plan)
    expect(messages).toContain('Unknown CPU model "cpu-foo".')
    expect(html).toContain('<option value="cpu-foo" selected="">cpu-foo (incompatible)</option>')
  })
})
