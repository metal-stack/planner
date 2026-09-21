import type { CidrField } from '../../derive/ip/ipPlan'
import type { IpFamily, IpFamilyKey, IpPlan } from '../../model/ipPlan'
import { usePlanStore } from '../../store/planStore'
import type { Info } from '../plan/docs'
import InfoBubble from '../plan/InfoBubble'
import { ipFieldAnchor } from '../plan/navigate'
import { IP_INFO } from './infos'
import { CidrInput, CidrListInput, PrefixInput } from './inputs'
import { kubernetesRangesInUla, randomUla48 } from './ula'
import { ACTION_ICON, Icon, SECTION_ICON, type LucideIcon } from '../icons'

type PrefixKey = 'tenantPrefix' | 'partitionPrefix' | 'projectPrefix' | 'nodePodPrefix'

type Row =
  | {
      kind: 'list'
      field: 'internetCidrs' | 'reserveCidrs'
      label: string
      add: string
      info?: Info
    }
  | { kind: 'cidr'; field: CidrField; label: string; info?: Info }
  | { kind: 'prefix'; field: PrefixKey; label: string; info?: Info; v6Only?: boolean }

const GROUPS: { title: string; icon: LucideIcon; info?: Info; rows: Row[]; ula?: boolean }[] = [
  {
    title: 'Internet',
    icon: SECTION_ICON.internet,
    info: IP_INFO.internet,
    rows: [
      { kind: 'list', field: 'internetCidrs', label: 'Internet ranges', add: 'Add range' },
      {
        kind: 'prefix',
        field: 'tenantPrefix',
        label: 'Tenant prefix',
        info: IP_INFO.tenantPrefix,
        v6Only: true,
      },
    ],
  },
  {
    title: 'Project networks',
    icon: SECTION_ICON.projectNetworks,
    info: IP_INFO.projectCidr,
    rows: [
      { kind: 'cidr', field: 'projectCidr', label: 'Project CIDR', info: IP_INFO.projectCidr },
      {
        kind: 'prefix',
        field: 'partitionPrefix',
        label: 'Super network per partition',
        info: IP_INFO.partitionPrefix,
      },
      {
        kind: 'prefix',
        field: 'projectPrefix',
        label: 'Project network',
        info: IP_INFO.projectPrefix,
      },
    ],
  },
  {
    title: 'Kubernetes',
    icon: SECTION_ICON.kubernetes,
    info: IP_INFO.gardener,
    ula: true,
    rows: [
      {
        kind: 'cidr',
        field: 'frrListenRange',
        label: 'FRR listen range',
        info: IP_INFO.frrListenRange,
      },
      { kind: 'cidr', field: 'shootPodCidr', label: 'Shoot pod CIDR' },
      { kind: 'cidr', field: 'shootServiceCidr', label: 'Shoot service CIDR' },
      { kind: 'cidr', field: 'seedPodCidr', label: 'Seed pod CIDR' },
      { kind: 'cidr', field: 'seedServiceCidr', label: 'Seed service CIDR' },
      {
        kind: 'list',
        field: 'reserveCidrs',
        label: 'Reserve ranges',
        add: 'Add reserve range',
        info: IP_INFO.reserve,
      },
      {
        kind: 'prefix',
        field: 'nodePodPrefix',
        label: 'Pod range per node',
        info: IP_INFO.nodePodPrefix,
      },
    ],
  },
]

const FAMILY = { ipv4: 4, ipv6: 6 } as const
const WIDTH = { ipv4: 32, ipv6: 128 } as const

function Cell({
  row,
  fk,
  family,
  onPatch,
}: {
  row: Row
  fk: IpFamilyKey
  family: IpFamily
  onPatch: (patch: Partial<IpFamily>) => void
}) {
  const anchor = ipFieldAnchor(`${fk}.${row.field}`)
  if (row.kind === 'prefix' && row.v6Only && fk === 'ipv4') {
    return <span className="py-1.5 text-xs text-gray-400">n/a for IPv4</span>
  }
  switch (row.kind) {
    case 'list':
      return (
        <CidrListInput
          idPrefix={anchor}
          values={family[row.field]}
          family={FAMILY[fk]}
          addLabel={row.add}
          onChange={(values) => onPatch({ [row.field]: values })}
        />
      )
    case 'cidr':
      return (
        <CidrInput
          id={anchor}
          value={family[row.field]}
          family={FAMILY[fk]}
          onChange={(value) => onPatch({ [row.field]: value })}
        />
      )
    case 'prefix':
      return (
        <PrefixInput
          id={anchor}
          value={family[row.field]}
          max={WIDTH[fk]}
          onChange={(value) => onPatch({ [row.field]: value })}
        />
      )
  }
}

/** The family inputs as the spreadsheet lays them out: one card per group,
 *  a row per field, an IPv4 and (with dual-stack) an IPv6 column. */
export default function FamilyInputs({ ipPlan }: { ipPlan: IpPlan }) {
  const patchIpFamily = usePlanStore((s) => s.patchIpFamily)
  const families: IpFamilyKey[] = ipPlan.ipv6.enabled ? ['ipv4', 'ipv6'] : ['ipv4']
  const grid = ipPlan.ipv6.enabled ? 'md:grid-cols-[13rem_1fr_1fr]' : 'md:grid-cols-[13rem_1fr]'

  return (
    <>
      {GROUPS.map((group) => (
        <section key={group.title} className="card p-4">
          <h3 className="text-sm font-semibold">
            <Icon icon={group.icon} className="mr-1.5 inline h-4 w-4 align-[-3px] text-gray-500" />
            {group.title}
            {group.info && <InfoBubble label={group.title} info={group.info} />}
          </h3>
          <div className={`mt-2 hidden gap-x-4 md:grid ${grid}`}>
            <span />
            {families.map((fk) => (
              <span key={fk} className="text-xs font-semibold text-gray-500">
                {fk === 'ipv4' ? 'IPv4' : 'IPv6'}
                {fk === 'ipv6' && group.ula && (
                  <>
                    <button
                      type="button"
                      onClick={() => patchIpFamily('ipv6', kubernetesRangesInUla(randomUla48()))}
                      className="ml-2 inline-flex items-center gap-1 font-medium text-brand-strong hover:underline"
                    >
                      <Icon icon={ACTION_ICON.random} className="h-3.5 w-3.5" />
                      Random ULA /48
                    </button>
                    <InfoBubble label="unique local addresses" info={IP_INFO.ula} />
                  </>
                )}
              </span>
            ))}
          </div>
          {group.rows.map((row) => (
            <div
              key={row.field}
              className={`grid items-start gap-x-4 gap-y-1 border-t border-gray-100 py-2 first-of-type:border-t-0 ${grid}`}
            >
              <span className="pt-1.5 text-sm text-gray-600">
                {row.label}
                {row.info && <InfoBubble label={row.label} info={row.info} />}
              </span>
              {families.map((fk) => (
                <div key={fk} className="min-w-0">
                  <span className="mb-0.5 block text-xs font-semibold text-gray-500 md:hidden">
                    {fk === 'ipv4' ? 'IPv4' : 'IPv6'}
                  </span>
                  <Cell
                    row={row}
                    fk={fk}
                    family={ipPlan[fk]}
                    onPatch={(patch) => patchIpFamily(fk, patch)}
                  />
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
    </>
  )
}
