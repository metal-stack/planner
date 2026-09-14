import { useMemo } from 'react'
import { deriveIpPlan } from '../derive/ip/ipPlan'
import { validateIpPlan } from '../derive/ip/validateIp'
import { ipPlanToCsv } from '../io/ipCsv'
import { downloadText } from '../io/download'
import { ipPresets } from '../model/ipPlan'
import { usePlanStore } from '../store/planStore'
import { useToastStore } from '../store/toastStore'
import AllocationCard from './ips/AllocationCard'
import ExampleClusterCard from './ips/ExampleClusterCard'
import FamilyInputs from './ips/FamilyInputs'
import { IP_INFO } from './ips/infos'
import InfraCard from './ips/InfraCard'
import ResultsCard from './ips/ResultsCard'
import MenuButton from './MenuButton'
import InfoBubble from './plan/InfoBubble'
import IssuesPanel from './plan/IssuesPanel'
import { ipFieldAnchor } from './plan/navigate'
import { ACTION_ICON, Icon } from './icons'

/** IPs tab: IPv4/IPv6 address plan of the setup (replaces the address
 *  planning spreadsheet). Inputs live in Plan.ipPlan, everything else is
 *  derived in src/derive/ip/. */
export default function IpView() {
  const plan = usePlanStore((s) => s.plan)
  const setIpv6Enabled = usePlanStore((s) => s.setIpv6Enabled)
  const applyIpPreset = usePlanStore((s) => s.applyIpPreset)
  const notify = useToastStore((s) => s.notify)
  const result = useMemo(() => deriveIpPlan(plan), [plan])
  const issues = useMemo(() => validateIpPlan(plan, result), [plan, result])
  const { ipPlan } = plan

  return (
    <div id={ipFieldAnchor('top')} className="max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">
          IP address plan
          <InfoBubble label="the IP address plan" info={IP_INFO.tab} />
        </h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={ipPlan.ipv6.enabled}
            onChange={(e) => setIpv6Enabled(e.target.checked)}
          />
          Dual-stack (IPv6)
        </label>
        <div className="ml-auto flex gap-2">
          <MenuButton
            label="Presets"
            icon={ACTION_ICON.presets}
            items={ipPresets}
            onSelect={(item) => {
              applyIpPreset(item.id)
              notify(`Applied preset "${item.name}".`, {
                action: { label: 'Undo', onClick: () => usePlanStore.temporal.getState().undo() },
              })
            }}
          />
          <button
            type="button"
            onClick={() =>
              downloadText(ipPlanToCsv(result), `${plan.name} address plan.csv`, 'text/csv')
            }
            className="btn-primary"
          >
            <Icon icon={ACTION_ICON.download} />
            Export address plan
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem] xl:items-start">
        <div className="min-w-0 space-y-4">
          <FamilyInputs ipPlan={ipPlan} />
        </div>
        <div className="space-y-4 xl:sticky xl:top-20">
          <IssuesPanel issues={issues} />
          <ResultsCard result={result} />
        </div>
      </div>

      <AllocationCard result={result} />
      <ExampleClusterCard result={result} />
      <InfraCard infra={ipPlan.infra} result={result} />
    </div>
  )
}
