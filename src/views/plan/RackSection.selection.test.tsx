import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveBom } from '../../derive/bom'
import { deriveRackLayout } from '../../derive/rackLayout'
import { createEmptyPlan, newRack, withRackKind } from '../../model/defaults'
import type { Plan } from '../../model/plan'
import { usePlanStore } from '../../store/planStore'
import type { SelectField } from './fields'
import RackSection from './RackSection'

const { fields } = vi.hoisted(() => ({ fields: new Map<string, (value: string) => void>() }))
vi.mock('./fields', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fields')>()
  return {
    ...actual,
    SelectField: (props: ComponentProps<typeof SelectField>) => {
      fields.set(props.label, props.onChange)
      return <actual.SelectField {...props} />
    },
  }
})

const orv3Model = 'server-gigabyte-to25-s12'
const confirm = vi.fn<(message: string) => boolean>()

function renderRack() {
  fields.clear()
  const partition = usePlanStore.getState().plan.partitions[0]
  renderToStaticMarkup(<RackSection partition={partition} rack={partition.racks[0]} issues={[]} />)
}

function loadPlan(plan: Plan) {
  usePlanStore.getState().replacePlan(plan)
  usePlanStore.temporal.getState().clear()
  vi.advanceTimersByTime(1000)
  renderRack()
}

function selectModel(modelId = orv3Model) {
  fields.get('Server model')!(modelId)
}

describe('automatic ORV3 selection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    confirm.mockReset().mockReturnValue(true)
    vi.stubGlobal('window', { confirm })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it.each(['single', 'rack-group'] as const)(
    'confirms a %s conversion, retains other servers, and derives adapters and trays',
    (kind) => {
      const plan = createEmptyPlan()
      const partition = plan.partitions[0]
      const rack = withRackKind(partition, partition.racks[0], kind)
      partition.racks[0] = rack
      // Edit the second group, leaving the first 19-inch group in place.
      rack.servers.push({ ...rack.servers[0], id: 'new-nodes', count: 3 })
      partition.racks.push(newRack(partition, 'single'))
      loadPlan(plan)
      selectModel()

      expect(confirm).toHaveBeenCalledOnce()
      expect(confirm.mock.calls[0][0]).toContain('21″ ORV3')
      expect(confirm.mock.calls[0][0]).toContain('mounting adapter kits')
      expect(confirm.mock.calls[0][0]).toContain('BOM')
      if (kind === 'rack-group') expect(confirm.mock.calls[0][0]).toContain('all three racks')
      const updated = usePlanStore.getState().plan
      const changedRack = updated.partitions[0].racks[0]
      expect(changedRack.widthInches).toBe(21)
      expect(changedRack.servers[0]).toEqual(rack.servers[0])
      expect(changedRack.servers[1].modelId).toBe(orv3Model)
      expect(updated.partitions[0].racks[1]).toEqual(partition.racks[1])
      expect(updated.partitions[0].rackDefaults).toEqual(partition.rackDefaults)
      const bom = deriveBom(updated)
      expect(bom.find((line) => line.catalogId === 'rack-adapter-19-to-21')?.quantity).toBe(5)
      expect(bom.find((line) => line.catalogId === 'chassis-gigabyte-to25-bt0')?.quantity).toBe(2)
      expect(
        deriveRackLayout(updated)[0]
          .racks.slice(1, kind === 'single' ? 2 : 4)
          .map((physical) => physical.widthInches),
      ).toEqual(kind === 'single' ? [21] : [21, 21, 21])

      usePlanStore.temporal.getState().undo()
      expect(usePlanStore.getState().plan).toEqual(plan)
      usePlanStore.temporal.getState().redo()
      expect(usePlanStore.getState().plan).toEqual(updated)
    },
  )

  it('leaves the entire plan and undo history unchanged when cancelled', () => {
    const plan = createEmptyPlan()
    const group = plan.partitions[0].racks[0].servers[0]
    group.compute = { cpuModelId: 'cpu-epyc-4124p' }
    group.nodeConfigs = { 0: { sizeId: group.sizeId, compute: group.compute } }
    loadPlan(plan)
    confirm.mockReturnValue(false)
    selectModel()
    expect(confirm).toHaveBeenCalledOnce()
    expect(usePlanStore.getState().plan).toBe(plan)
    expect(usePlanStore.temporal.getState().pastStates).toHaveLength(0)
  })

  it('switches automatically without prompting when no 19-inch nodes are placed', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].racks[0].servers[0].count = 0
    loadPlan(plan)
    selectModel()
    expect(confirm).not.toHaveBeenCalled()
    expect(usePlanStore.getState().plan.partitions[0].racks[0].widthInches).toBe(21)
  })

  it('does not prompt again in an ORV3 rack or switch back when selecting EIA', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].racks[0].widthInches = 21
    loadPlan(plan)
    selectModel()
    renderRack()
    selectModel('server-microcloud-h13')
    expect(confirm).not.toHaveBeenCalled()
    expect(usePlanStore.getState().plan.partitions[0].racks[0].widthInches).toBe(21)
  })

  it('keeps EIA selections in a 19-inch rack without prompting', () => {
    loadPlan(createEmptyPlan())
    selectModel('server-bigtwin-x12')
    expect(confirm).not.toHaveBeenCalled()
    expect(usePlanStore.getState().plan.partitions[0].racks[0].widthInches).toBe(19)
  })

  it('keeps an ORV3 model when changing between worker and storage roles', () => {
    const plan = createEmptyPlan()
    plan.partitions[0].racks[0].servers[0].modelId = orv3Model
    loadPlan(plan)
    fields.get('Role')!('storage')
    expect(usePlanStore.getState().plan.partitions[0].racks[0].servers[0]).toMatchObject({
      modelId: orv3Model,
      role: 'storage',
    })
  })
})
