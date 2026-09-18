import { useState } from 'react'
import type { Deployment } from '../../model/deployment'
import { usePlanStore } from '../../store/planStore'
import { NumberField } from '../plan/fields'
import { ANSIBLE_INFO } from './infos'
import { Icon, SECTION_ICON } from '../icons'

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-gray-600">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm"
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
  onChange,
}: {
  label: string
  values: string[]
  placeholder?: string
  onChange: (values: string[]) => void
}) {
  const [draft, setDraft] = useState(values.join(', '))
  const shown = parseList(draft).join(',') === values.join(',') ? draft : values.join(', ')
  return (
    <TextField
      label={label}
      value={shown}
      placeholder={placeholder}
      onChange={(text) => {
        setDraft(text)
        onChange(parseList(text))
      }}
    />
  )
}

/** Inputs of the export the plan cannot derive (Plan.deployment). */
export default function SettingsCard({ deployment: d }: { deployment: Deployment }) {
  const patch = usePlanStore((s) => s.patchDeployment)
  return (
    <section className="card p-4">
      <h3 className="text-sm font-semibold">
        <Icon
          icon={SECTION_ICON.deployment}
          className="mr-1.5 inline h-4 w-4 align-[-3px] text-gray-500"
        />
        Deployment settings{' '}
        <span className="font-normal text-gray-500">· what the plan cannot know</span>
      </h3>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <TextField
          label="Inventory"
          value={d.environment}
          placeholder="prod"
          onChange={(environment) => patch({ environment })}
        />
        <TextField
          label="metal-stack release"
          value={d.metalStackRelease}
          placeholder="e.g. v0.21.6"
          onChange={(metalStackRelease) => patch({ metalStackRelease })}
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
        <div className="col-span-2 md:col-span-1 xl:col-span-2">
          <ListField
            label="Name servers"
            values={d.nameservers}
            placeholder="192.0.2.53, 198.51.100.53"
            onChange={(nameservers) => patch({ nameservers })}
          />
        </div>
        <div className="col-span-2 md:col-span-1 xl:col-span-2">
          <ListField
            label="NTP servers"
            values={d.ntpServers}
            placeholder="192.0.2.123"
            onChange={(ntpServers) => patch({ ntpServers })}
          />
        </div>
        <div className="col-span-2 md:col-span-1 xl:col-span-2">
          <ListField
            label="SSH source ranges (switches)"
            values={d.sshSourceRanges}
            placeholder="10.0.0.0/8"
            onChange={(sshSourceRanges) => patch({ sshSourceRanges })}
          />
        </div>
      </div>
    </section>
  )
}
