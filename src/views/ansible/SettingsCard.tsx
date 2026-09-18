import { useState, type ReactNode } from 'react'
import type { PartitionDevices } from '../../derive/devices'
import type { Ci, CiPlatform, Deployment } from '../../model/deployment'
import { usePlanStore } from '../../store/planStore'
import { NumberField, SelectField } from '../plan/fields'
import InfoBubble from '../plan/InfoBubble'
import type { Info } from '../plan/docs'
import { ANSIBLE_INFO } from './infos'
import { Icon, SECTION_ICON } from '../icons'

function TextField({
  label,
  info,
  value,
  placeholder,
  required,
  onChange,
}: {
  label: string
  info?: Info
  value: string
  placeholder?: string
  /** Marks the field while it is empty (the export writes CHANGE_ME). */
  required?: boolean
  onChange: (value: string) => void
}) {
  const missing = required && !value.trim()
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-gray-600">
        {label}
        {info && <InfoBubble label={label} info={info} />}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-md border bg-white px-2 py-1.5 font-mono text-sm ${
          missing ? 'border-amber-400 bg-amber-50' : 'border-gray-300'
        }`}
      />
    </label>
  )
}

const parseList = (text: string) => text.split(/[\s,]+/).filter(Boolean)

/** Comma or space separated list. The draft keeps what is typed (a
 *  trailing comma) and follows the plan when it changes elsewhere (undo). */
function ListField({
  label,
  values,
  placeholder,
  required,
  onChange,
}: {
  label: string
  values: string[]
  placeholder?: string
  required?: boolean
  onChange: (values: string[]) => void
}) {
  const [draft, setDraft] = useState(values.join(', '))
  const shown = parseList(draft).join(',') === values.join(',') ? draft : values.join(', ')
  return (
    <TextField
      label={label}
      value={shown}
      placeholder={placeholder}
      required={required}
      onChange={(text) => {
        setDraft(text)
        onChange(parseList(text))
      }}
    />
  )
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

const PLATFORMS: { value: CiPlatform; label: string }[] = [
  { value: 'gitlab', label: 'GitLab CI' },
  { value: 'github', label: 'GitHub Actions' },
  { value: 'both', label: 'GitLab CI and GitHub Actions' },
  { value: 'none', label: 'None' },
]

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <div>
    <h4 className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">{title}</h4>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{children}</div>
  </div>
)

const wide = 'col-span-2 md:col-span-1 xl:col-span-2'

/** Inputs of the export the plan cannot derive (Plan.deployment): what
 *  differs for every installation up front, defaults under Advanced. */
export default function SettingsCard({
  deployment: d,
  partitions,
}: {
  deployment: Deployment
  partitions: PartitionDevices[]
}) {
  const patch = usePlanStore((s) => s.patchDeployment)
  const patchCi = (ci: Partial<Ci>) => patch({ ci: { ...d.ci, ...ci } })

  return (
    <section className="card p-4">
      <h3 className="text-sm font-semibold">
        <Icon
          icon={SECTION_ICON.deployment}
          className="mr-1.5 inline h-4 w-4 align-[-3px] text-gray-500"
        />
        Deployment settings{' '}
        <span className="font-normal text-gray-500">· what differs for every installation</span>
      </h3>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <TextField
          label="metal-stack release"
          value={d.metalStackRelease}
          placeholder="e.g. v0.21.6"
          required
          onChange={(metalStackRelease) => patch({ metalStackRelease })}
        />
        <div className={wide}>
          <TextField
            label="Control plane domain"
            info={ANSIBLE_INFO.controlPlane}
            value={d.controlPlaneDomain}
            placeholder="metal.example.com"
            required
            onChange={(controlPlaneDomain) => patch({ controlPlaneDomain })}
          />
        </div>
      </div>

      <details className="mt-4" data-advanced>
        <summary className="cursor-pointer text-sm font-semibold text-gray-700">
          Advanced{' '}
          <span className="font-normal text-gray-500">
            · servers, inventory, role versions and pipeline, with defaults
          </span>
        </summary>
        <div className="mt-3 space-y-4">
          <Group title="Servers">
            <div className={wide}>
              <ListField
                label="Name servers"
                values={d.nameservers}
                placeholder="1.1.1.1, 8.8.8.8"
                required
                onChange={(nameservers) => patch({ nameservers })}
              />
            </div>
            <div className={wide}>
              <ListField
                label="NTP servers"
                values={d.ntpServers}
                placeholder="0.europe.pool.ntp.org"
                required
                onChange={(ntpServers) => patch({ ntpServers })}
              />
            </div>
            <div className={wide}>
              <ListField
                label="SSH source ranges (switches)"
                values={d.sshSourceRanges}
                placeholder="10.0.0.0/8"
                onChange={(sshSourceRanges) => patch({ sshSourceRanges })}
              />
            </div>
          </Group>

          <Group title="Inventory">
            <TextField
              label="Inventory name"
              value={d.environment}
              placeholder="prod"
              onChange={(environment) => patch({ environment })}
            />
            <TextField
              label="Timezone"
              value={d.timezone}
              onChange={(timezone) => patch({ timezone })}
            />
            <NumberField
              label="First ASN"
              info={ANSIBLE_INFO.asn}
              value={d.asnBase}
              min={4200000000}
              max={4294967294}
              onChange={(asnBase) => {
                if (asnBase <= 4294967294) patch({ asnBase })
              }}
            />
            <TextField
              label="metal-roles version"
              value={d.metalRolesVersion}
              onChange={(metalRolesVersion) => patch({ metalRolesVersion })}
            />
            <TextField
              label="ansible-common version"
              value={d.ansibleCommonVersion}
              onChange={(ansibleCommonVersion) => patch({ ansibleCommonVersion })}
            />
          </Group>

          <Group title="Pipeline">
            <div className={wide}>
              <SelectField
                label="CI/CD pipeline"
                info={ANSIBLE_INFO.ci}
                value={d.ci.platform}
                options={PLATFORMS}
                onChange={(platform) => patchCi({ platform: platform as CiPlatform })}
              />
            </div>
            {d.ci.platform !== 'none' && (
              <>
                <div className={wide}>
                  <TextField
                    label="Container image"
                    value={d.ci.image}
                    onChange={(image) => patchCi({ image })}
                  />
                </div>
                <TextField
                  label="Deploy branch"
                  value={d.ci.branch}
                  onChange={(branch) => patchCi({ branch })}
                />
                <TextField
                  label="SSH user"
                  value={d.ci.sshUser}
                  placeholder="Ansible default"
                  onChange={(sshUser) => patchCi({ sshUser })}
                />
                <div className="col-span-2 flex flex-col justify-end gap-1.5 pb-1">
                  <Check
                    label="Check SSH host keys (SSH_KNOWN_HOSTS)"
                    checked={d.ci.hostKeyChecking}
                    onChange={(hostKeyChecking) => patchCi({ hostKeyChecking })}
                  />
                  <Check
                    label="Dry run before deploying (--check --diff)"
                    checked={d.ci.dryRun}
                    onChange={(dryRun) => patchCi({ dryRun })}
                  />
                </div>
                {partitions.map((p) => (
                  <TextField
                    key={p.partitionId}
                    label={`Runner tag, ${p.partitionName}`}
                    value={d.ci.runnerTags[p.partitionId] ?? ''}
                    placeholder={p.slug}
                    onChange={(tag) =>
                      patchCi({ runnerTags: { ...d.ci.runnerTags, [p.partitionId]: tag } })
                    }
                  />
                ))}
                <span className="col-span-2 self-end pb-2 text-xs text-gray-500">
                  Runners must reach the partition&apos;s management network
                  <InfoBubble label="runner tags" info={ANSIBLE_INFO.runners} />
                </span>
              </>
            )}
          </Group>
        </div>
      </details>
    </section>
  )
}
