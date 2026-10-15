import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createEmptyPlan } from '../model/defaults'
import { deriveRackLayout } from '../derive/rackLayout'
import { Rack } from './RackLayoutView'

describe('rack infrastructure diagram', () => {
  it('renders both shelf feeds and combined height usage while hiding the bus bar', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].racks[0].widthInches = 21
    const rack = deriveRackLayout(plan)[0].racks[1]
    const html = renderToStaticMarkup(<Rack rack={rack} />)
    expect(html).toContain('Power shelf A1')
    expect(html).toContain('Power shelf B1')
    expect(html).toContain('5.5 kW fitted')
    expect(html).not.toContain('33.0 kW')
    expect(html).not.toContain('bus bar')
    expect(html).toContain(`${rack.usedU} of 42 OU`)
  })

  it('hides the bus bar in empty racks and leaves EIA diagrams unchanged', () => {
    const plan = createEmptyPlan()
    const partition = plan.partitions[0]
    partition.racks[0].widthInches = 21
    partition.racks[0].servers = []
    partition.racks[0].leafCount = 0
    partition.fabric.mgmt.leafPerRack = 0
    const [central, empty] = deriveRackLayout(plan)[0].racks
    const emptyHtml = renderToStaticMarkup(<Rack rack={empty} />)
    expect(emptyHtml).not.toContain('bus bar')
    expect(emptyHtml).not.toContain('Power shelf')
    const eiaHtml = renderToStaticMarkup(<Rack rack={central} />)
    expect(eiaHtml).not.toContain('bus bar')
    expect(eiaHtml).not.toContain('Power shelf')
  })
})
