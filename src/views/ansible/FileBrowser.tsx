import { useState } from 'react'
import type { AnsibleFile, Placeholder } from '../../derive/ansible'
import { useToastStore } from '../../store/toastStore'
import { ACTION_ICON, FILE_ICON, Icon } from '../icons'
import Preview, { type PreviewMode } from './Preview'

interface Dir {
  name: string
  path: string
  dirs: Dir[]
  files: AnsibleFile[]
}

/** Folder tree of the export; folders first, both in export order. */
function buildTree(files: AnsibleFile[]): Dir {
  const root: Dir = { name: '', path: '', dirs: [], files: [] }
  for (const f of files) {
    const parts = f.path.split('/')
    let dir = root
    for (const part of parts.slice(0, -1)) {
      const path = dir.path ? `${dir.path}/${part}` : part
      let next = dir.dirs.find((d) => d.name === part)
      if (!next) {
        next = { name: part, path, dirs: [], files: [] }
        dir.dirs.push(next)
      }
      dir = next
    }
    dir.files.push(f)
  }
  return root
}

function DirView({
  dir,
  depth,
  selected,
  todos,
  onSelect,
}: {
  dir: Dir
  depth: number
  selected: string
  todos: Map<string, number>
  onSelect: (path: string) => void
}) {
  const pad = { paddingLeft: `${0.5 + depth * 0.875}rem` }
  return (
    <>
      {dir.dirs.map((d) => (
        <details key={d.path} open={d.name !== 'host_vars' || d.files.length <= 12}>
          <summary
            style={pad}
            className="flex cursor-pointer items-center gap-1.5 py-0.5 pr-2 text-gray-600 hover:bg-gray-50"
          >
            <Icon icon={FILE_ICON.folder} className="h-3.5 w-3.5 text-gray-400" />
            {d.name}
          </summary>
          <DirView
            dir={d}
            depth={depth + 1}
            selected={selected}
            todos={todos}
            onSelect={onSelect}
          />
        </details>
      ))}
      {dir.files.map((f) => {
        const todo = todos.get(f.path) ?? 0
        return (
          <button
            key={f.path}
            type="button"
            onClick={() => onSelect(f.path)}
            style={pad}
            className={`flex w-full items-center gap-1.5 py-0.5 pr-2 text-left ${
              f.path === selected ? 'bg-brand-tint font-medium text-ink' : 'hover:bg-gray-50'
            }`}
          >
            <Icon icon={FILE_ICON.file} className="h-3.5 w-3.5 text-gray-400" />
            <span className="min-w-0 truncate">{f.path.split('/').pop()}</span>
            {todo > 0 && (
              <span
                title={`${todo} value${todo === 1 ? '' : 's'} to fill in`}
                className="ml-auto rounded bg-amber-100 px-1 text-[10px] leading-4 font-bold text-amber-800"
              >
                {todo}
              </span>
            )}
          </button>
        )
      })}
    </>
  )
}

export default function FileBrowser({
  files,
  placeholders,
  selected,
  onSelect,
}: {
  files: AnsibleFile[]
  placeholders: Placeholder[]
  selected: string
  onSelect: (path: string) => void
}) {
  const notify = useToastStore((s) => s.notify)
  const [mode, setMode] = useState<PreviewMode>('rendered')
  const file = files.find((f) => f.path === selected) ?? files[0]
  const tree = buildTree(files)
  const todos = new Map<string, number>()
  for (const p of placeholders) todos.set(p.file, (todos.get(p.file) ?? 0) + 1)

  return (
    <section className="card grid min-w-0 grid-cols-[minmax(0,1fr)] md:grid-cols-[17rem_minmax(0,1fr)]">
      <nav
        aria-label="Files"
        className="max-h-[70vh] overflow-y-auto border-b border-gray-100 py-2 font-mono text-xs md:border-r md:border-b-0"
      >
        <DirView dir={tree} depth={0} selected={file.path} todos={todos} onSelect={onSelect} />
      </nav>
      <div className="min-w-0">
        <header className="flex items-center gap-2 border-b border-gray-100 px-4 py-2">
          <span className="min-w-0 truncate font-mono text-xs text-gray-600">{file.path}</span>
          {file.path.endsWith('.md') && (
            <div className="ml-auto flex rounded-md border border-gray-300 p-0.5 text-xs">
              {(['rendered', 'source'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`rounded px-2 py-0.5 font-medium ${
                    mode === m ? 'bg-ink text-white' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {m === 'rendered' ? 'Rendered' : 'Source'}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() =>
              navigator.clipboard
                .writeText(file.content)
                .then(() => notify(`Copied ${file.path.split('/').pop()}.`))
                .catch(() => notify('Copying failed.', { kind: 'error' }))
            }
            className={`btn-secondary ${file.path.endsWith('.md') ? '' : 'ml-auto'}`}
          >
            <Icon icon={ACTION_ICON.copy} />
            Copy
          </button>
        </header>
        <Preview file={file} mode={mode} />
      </div>
    </section>
  )
}
