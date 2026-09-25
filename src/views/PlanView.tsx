import { useMemo, useRef } from 'react'
import { physicalRackCount } from '../derive/rackLayout'
import { validatePlan } from '../derive/validate'
import { exportPlanJson, importPlanJson } from '../io/json'
import { downloadText } from '../io/download'
import { usePlanStore } from '../store/planStore'
import { useToastStore } from '../store/toastStore'
import ExternalNetworksSection from './plan/ExternalNetworksSection'
import CentralRackSection from './plan/CentralRackSection'
import RackSection from './plan/RackSection'
import { DOCS } from './plan/docs'
import InfoBubble from './plan/InfoBubble'
import IntroCard from './plan/IntroCard'
import SidePanel from './plan/SidePanel'
import TemplateMenu from './plan/TemplateMenu'
import { ACTION_ICON, Icon, SECTION_ICON } from './icons'

const undoAction = {
  label: 'Undo',
  onClick: () => usePlanStore.temporal.getState().undo(),
}

export default function PlanView() {
  const plan = usePlanStore((s) => s.plan)
  const setPlanName = usePlanStore((s) => s.setPlanName)
  const addRack = usePlanStore((s) => s.addRack)
  const addPartition = usePlanStore((s) => s.addPartition)
  const removePartition = usePlanStore((s) => s.removePartition)
  const renamePartition = usePlanStore((s) => s.renamePartition)
  const replacePlan = usePlanStore((s) => s.replacePlan)
  const resetPlan = usePlanStore((s) => s.resetPlan)
  const notify = useToastStore((s) => s.notify)
  const fileInput = useRef<HTMLInputElement>(null)
  const issues = useMemo(() => validatePlan(plan), [plan])

  async function onImportFile(file: File | undefined) {
    if (!file) return
    try {
      const imported = importPlanJson(await file.text())
      replacePlan(imported)
      notify(`Imported "${imported.name}".`, { action: undoAction })
    } catch (err) {
      notify(`Import failed: ${err instanceof Error ? err.message : String(err)}`, {
        kind: 'error',
      })
    }
  }

  return (
    <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
      <div className="min-w-0 flex-1 space-y-6 xl:max-w-5xl">
        <IntroCard />
        {/* Plan actions first, then the plan's own settings. */}
        <div className="space-y-3">
          <div className="flex flex-wrap justify-end gap-2">
            <TemplateMenu />
            <button
              onClick={() =>
                downloadText(exportPlanJson(plan), `${plan.name}.json`, 'application/json')
              }
              className="btn-primary"
            >
              <Icon icon={ACTION_ICON.download} />
              Export JSON
            </button>
            <button onClick={() => fileInput.current?.click()} className="btn-secondary">
              <Icon icon={ACTION_ICON.upload} />
              Import JSON
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                void onImportFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <button
              onClick={() => {
                resetPlan()
                notify('Plan reset to an empty plan.', { action: undoAction })
              }}
              className="btn-danger"
            >
              <Icon icon={ACTION_ICON.reset} />
              Reset
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Plan name</span>
              <input
                type="text"
                value={plan.name}
                onChange={(e) => setPlanName(e.target.value)}
                className="w-72 rounded-md border border-gray-300 bg-white px-3 py-2"
              />
            </label>
          </div>
        </div>

        {plan.partitions.map((partition) => (
          <section key={partition.id} className="space-y-4">
            <div className="flex flex-wrap items-end gap-3 border-b border-gray-200 pb-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">
                  <Icon
                    icon={SECTION_ICON.partition}
                    className="mr-1.5 inline h-4 w-4 align-[-3px] text-gray-500"
                  />
                  Partition
                  <InfoBubble
                    label="partitions"
                    info={{
                      text: 'A partition is the metal-stack term for hardware controlled by one network topology (usually a rack or a group of racks) and therefore one failure domain. Machines in a partition share the same switch plane.',
                      href: DOCS.architecture,
                    }}
                  />
                </span>
                <input
                  type="text"
                  value={partition.name}
                  onChange={(e) => renamePartition(partition.id, e.target.value)}
                  className="w-56 rounded-md border border-gray-300 bg-white px-2 py-1.5"
                />
              </label>
              <span className="pb-2 text-sm text-gray-600">
                {physicalRackCount(partition)} racks incl. central
              </span>
              <button
                onClick={() => {
                  removePartition(partition.id)
                  notify(`Removed ${partition.name}.`, { action: undoAction })
                }}
                disabled={plan.partitions.length <= 1}
                title={
                  plan.partitions.length <= 1
                    ? 'A plan needs at least one partition'
                    : 'Remove this partition and its racks'
                }
                className="btn-danger ml-auto"
              >
                <Icon icon={ACTION_ICON.remove} />
                Remove partition
              </button>
            </div>
            <CentralRackSection partition={partition} issues={issues} />
            {partition.racks.map((rack) => (
              <RackSection key={rack.id} partition={partition} rack={rack} issues={issues} />
            ))}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => addRack(partition.id)} className="btn-secondary">
                <Icon icon={SECTION_ICON.rack} />
                Add rack to {partition.name}
              </button>
              <button
                onClick={() => addRack(partition.id, 'rack-group')}
                title="Three physical racks sharing the middle rack's leaf pair and mgmt leaf"
                className="btn-secondary"
              >
                <Icon icon={SECTION_ICON.rackGroup} />
                Add rack group to {partition.name}
              </button>
            </div>
          </section>
        ))}

        <button
          onClick={() => addPartition()}
          className="btn-secondary border-dashed border-gray-400"
        >
          <Icon icon={ACTION_ICON.add} />
          Add partition
        </button>

        <ExternalNetworksSection plan={plan} />
      </div>

      <aside className="w-full shrink-0 xl:sticky xl:top-6 xl:max-h-[calc(100vh-6rem)] xl:w-80 xl:overflow-y-auto">
        <SidePanel plan={plan} issues={issues} />
      </aside>
    </div>
  )
}
