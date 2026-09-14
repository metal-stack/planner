import { countIssues, type Issue } from '../../derive/validate'
import { anchorFor, navigateTo } from './navigate'
import { Icon, SEVERITY_ICON } from '../icons'

/** Clickable issue list: each entry scrolls to and flashes the editor
 *  section it belongs to. */
export default function IssuesPanel({ issues }: { issues: Issue[] }) {
  const { errors, warnings } = countIssues(issues)

  return (
    <section className="card">
      <header className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold">Issues</h3>
        {issues.length === 0 ? (
          <span className="flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            <Icon icon={SEVERITY_ICON.ok} className="h-3.5 w-3.5" />
            none
          </span>
        ) : (
          <span className="flex gap-1.5 text-xs font-medium">
            {errors > 0 && (
              <span className="flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-red-800">
                <Icon icon={SEVERITY_ICON.error} className="h-3.5 w-3.5" />
                {errors}
              </span>
            )}
            {warnings > 0 && (
              <span className="flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-amber-800">
                <Icon icon={SEVERITY_ICON.warning} className="h-3.5 w-3.5" />
                {warnings}
              </span>
            )}
          </span>
        )}
      </header>
      {issues.length === 0 ? (
        <p className="px-4 py-3 text-sm text-gray-500">
          No capacity or compatibility problems found.
        </p>
      ) : (
        <ul className="max-h-80 divide-y divide-gray-100 overflow-y-auto">
          {issues.map((issue, i) => {
            const anchor = anchorFor(issue.target)
            const error = issue.severity === 'error'
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => navigateTo(issue.target)}
                  disabled={!anchor}
                  className={`flex w-full gap-2 border-l-[3px] px-3 py-2 text-left text-sm ${
                    error ? 'border-red-500' : 'border-amber-500'
                  } ${anchor ? 'hover:bg-gray-50' : ''}`}
                >
                  <Icon
                    icon={error ? SEVERITY_ICON.error : SEVERITY_ICON.warning}
                    className={`mt-0.5 h-4 w-4 ${error ? 'text-red-600' : 'text-amber-600'}`}
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-gray-500">{issue.where}</span>
                    <span className={error ? 'text-red-800' : 'text-amber-800'}>
                      {issue.message}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
