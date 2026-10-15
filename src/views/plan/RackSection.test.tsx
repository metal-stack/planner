import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createEmptyPlan } from '../../model/defaults'
import { serversForUsage } from '../../model/catalog'
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
  it('renders the CPU socket count and active RAM limit after import', () => {
    const plan = createEmptyPlan()
    const group = plan.partitions[0].racks[0].servers[0]
    group.modelId = 'server-bigtwin-x12'
    const single = renderImportedRack(plan).html
    expect(single).toMatch(/CPU sockets<\/span><input type="number" min="1" max="2"[^>]*value="1"/)
    expect(single).toContain('min="1" max="8"')
    group.compute = { cpuCount: 2 }
    const dual = renderImportedRack(plan).html
    expect(dual).toMatch(/CPU sockets<\/span><input type="number" min="1" max="2"[^>]*value="2"/)
    expect(dual).toContain('min="2" max="16"')
    expect(dual).toContain('2× Xeon Silver 4309Y')
    expect(dual).toContain('n1-medium-x86 (8 cores, 32 GiB, customized)')
  })

  it('does not offer dual CPUs on a single-socket server', () => {
    expect(renderImportedRack(createEmptyPlan()).html).not.toContain('CPU sockets')
  })

  it('edits the effective single-node configuration without a position selector', () => {
    const plan = createEmptyPlan()
    const group = plan.partitions[0].racks[0].servers[0]
    group.modelId = 'server-superserver-tn12'
    group.nodeConfigs = { 0: { sizeId: group.sizeId, compute: { cpuCount: 2 } } }
    const { html } = renderImportedRack(plan)
    expect(html).not.toContain('All nodes')
    expect(html).not.toContain('Configure all nodes')
    expect(html).not.toContain('Reset chassis position')
    expect(html).not.toContain('Selecting a number above')
    expect(html).toMatch(/CPU sockets<\/span><input type="number" min="1" max="2"[^>]*value="2"/)
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

  it('keeps unsupported imported X14 memory visible', () => {
    const plan = createEmptyPlan()
    const group = plan.partitions[0].racks[0].servers[0]
    group.modelId = 'server-bigtwin-x14'
    group.compute = { dimmModelId: 'mem-ddr5r-16g' }
    const { html, messages } = renderImportedRack(plan)
    expect(messages.some((message) => message.includes('requires 6400 MT/s-rated DIMMs'))).toBe(
      true,
    )
    expect(html).toContain(
      '<option value="mem-ddr5r-16g" selected="">MTC10F1084S1RC48BA1 (incompatible)</option>',
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

describe('rack format controls', () => {
  it('groups server choices once, retaining lifecycle notes and the selected model', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].racks[0].widthInches = 21
    const { html } = renderImportedRack(plan)
    const groups = [...html.matchAll(/<optgroup label="([^"]+)">([\s\S]*?)<\/optgroup>/g)]
    expect(groups.map((group) => group[1])).toEqual([
      'ORV3',
      'Multi-node Servers',
      'Single-node Servers',
      'Alpha',
      'EOL Systems',
    ])
    expect(groups[0][2]).toContain('TO25-S12-AA01 (alpha)')
    expect(groups[1][2]).toContain(
      '<option value="server-microcloud-h13" selected="">AS-3015MR-H8TNR</option>',
    )
    expect(groups[1][2]).toContain('SYS-220BT-HNTR')
    expect(groups[2][2]).toContain('SYS-621C-TN12R')
    expect(groups[3][2]).toContain('SYS-222BT-HNR (alpha)')
    expect(groups[4][2]).toContain('SYS-2029U-TN24R4T (alpha, end of life)')
    expect(groups[4][2]).toContain('SD530 (alpha, withdrawn)')
    const ids = groups.flatMap((group) =>
      [...group[2].matchAll(/<option value="([^"]+)"/g)].map((option) => option[1]),
    )
    expect(ids.sort()).toEqual(
      serversForUsage('worker', 21)
        .map((item) => item.id)
        .sort(),
    )
    plan.partitions[0].racks[0].widthInches = 19
    expect(renderImportedRack(plan).html).toContain('<optgroup label="ORV3">')
  })

  it('does not offer an adapter-count override for ORV3 racks', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].racks[0].widthInches = 21
    const { html } = renderImportedRack(plan)
    expect(html).not.toContain('Adapters per chassis')
    expect(html).not.toContain('Rail kit override')
    expect(html).not.toContain('Use automatic')
  })

  it('offers ORV3 choices in either format and shows OU height for ORV3 racks', () => {
    const plan = createEmptyPlan()
    expect(renderImportedRack(plan).html).toContain('TO25-S12-AA01')
    const rack = plan.partitions[0].racks[0]
    rack.widthInches = 21
    const { html } = renderImportedRack(plan)
    expect(html).toContain('TO25-S12-AA01 (alpha)')
    expect(html).toContain('Height (OU)')
    expect(html.match(/<option value="21"/g)).toHaveLength(1)
    expect(html).toContain('AS-3015MR-H8TNR</option>')
    expect(html).not.toContain('AS-3015MR-H8TNR (incompatible)')
    rack.servers[0].modelId = 'server-gigabyte-to25-s12'
    rack.widthInches = 19
    const imported = renderImportedRack(plan)
    expect(imported.html).toContain(
      '<option value="server-gigabyte-to25-s12" selected="">TO25-S12-AA01 (alpha)</option>',
    )
    expect(imported.messages.some((message) => message.includes('requires a 21″ rack'))).toBe(true)
  })
})
