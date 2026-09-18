import { useMemo, useState } from 'react'
import { deriveAnsible, type Placeholder } from '../derive/ansible'
import { slugify } from '../derive/devices'
import { ansibleZip } from '../io/ansibleZip'
import { downloadBlob } from '../io/download'
import { usePlanStore } from '../store/planStore'
import { useToastStore } from '../store/toastStore'
import FileBrowser from './ansible/FileBrowser'
import { ANSIBLE_INFO } from './ansible/infos'
import SettingsCard from './ansible/SettingsCard'
import InfoBubble from './plan/InfoBubble'
import { navigateTo } from './plan/navigate'
import { ACTION_ICON, Icon, SECTION_ICON, SEVERITY_ICON } from './icons'

/** Ansible tab: inventory, variables and playbooks for the metal-roles
 *  partition roles, derived in src/derive/ansible/, previewed per file and
 *  downloaded as a zip. */
export default function AnsibleView() {
  const plan = usePlanStore((s) => s.plan)
  const notify = useToastStore((s) => s.notify)
  const result = useMemo(() => deriveAnsible(plan), [plan])
  const [selected, setSelected] = useState('README.md')
  const folder = `${slugify(plan.name) || 'metal-stack'}-ansible`

  const byFile = new Map<string, Placeholder[]>()
  for (const p of result.placeholders) byFile.set(p.file, [...(byFile.get(p.file) ?? []), p])

  const download = async () => {
    try {
      const bytes = await ansibleZip(result.files, folder)
      downloadBlob(new Blob([bytes as BlobPart], { type: 'application/zip' }), `${folder}.zip`)
    } catch {
      notify('Creating the zip failed.', { kind: 'error' })
    }
  }

  return (
    <div className="max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">
          Ansible deployment
          <InfoBubble label="the Ansible export" info={ANSIBLE_INFO.tab} />
        </h2>
        <span className="text-sm text-gray-500">
          {result.files.length} files, {result.placeholders.length} values to fill in
        </span>
        <button type="button" onClick={download} className="btn-primary ml-auto">
          <Icon icon={ACTION_ICON.download} />
          Download zip
        </button>
      </div>

      <SettingsCard deployment={plan.deployment} partitions={result.devices} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <FileBrowser
          files={result.files}
          placeholders={result.placeholders}
          selected={selected}
          onSelect={setSelected}
        />

        <div className="space-y-4 xl:sticky xl:top-20">
          {result.notes.length > 0 && (
            <section className="card">
              <header className="border-b border-gray-100 px-4 py-2.5">
                <h3 className="text-sm font-semibold">Addresses left open</h3>
              </header>
              <ul className="divide-y divide-gray-100">
                {result.notes.map((n, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => navigateTo({ section: 'ips', field: 'infra.cidr' })}
                      className="flex w-full gap-2 border-l-[3px] border-amber-500 px-3 py-2 text-left text-sm hover:bg-gray-50"
                    >
                      <Icon
                        icon={SEVERITY_ICON.warning}
                        className="mt-0.5 h-4 w-4 text-amber-600"
                      />
                      <span className="min-w-0">{n}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card">
            <header className="flex items-center border-b border-gray-100 px-4 py-2.5">
              <h3 className="text-sm font-semibold">
                <Icon
                  icon={SECTION_ICON.placeholders}
                  className="mr-1.5 inline h-4 w-4 align-[-3px] text-gray-500"
                />
                To fill in{' '}
                <span className="font-normal text-gray-500">
                  · {result.placeholders.length} CHANGE_ME
                </span>
                <InfoBubble label="values to fill in" info={ANSIBLE_INFO.placeholders} />
              </h3>
            </header>
            <ul className="max-h-[60vh] divide-y divide-gray-100 overflow-y-auto">
              {[...byFile].map(([file, list]) => (
                <li key={file}>
                  <button
                    type="button"
                    onClick={() => setSelected(file)}
                    className={`block w-full px-4 py-2 text-left hover:bg-gray-50 ${
                      file === selected ? 'bg-brand-tint' : ''
                    }`}
                  >
                    <span className="block truncate font-mono text-xs text-gray-500">
                      {file.replace(/^inventories\/[^/]+\//, '')}
                    </span>
                    {list.map((p, i) => (
                      <span key={i} className="mt-0.5 block text-sm">
                        <code className="text-xs">{p.key}</code>
                        <span className="text-gray-600">: {p.reason}</span>
                      </span>
                    ))}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
