import { countIssues, type Issue } from '../../derive/validate'
import { Icon, SEVERITY_ICON } from '../icons'

/** Compact "2 errors · 1 warning" chips for a section header. */
export default function IssueBadges({ issues }: { issues: Issue[] }) {
  const { errors, warnings } = countIssues(issues)
  if (errors === 0 && warnings === 0) return null
  return (
    <span className="flex items-center gap-1.5">
      {errors > 0 && (
        <span className="flex items-center gap-1 rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-800">
          <Icon icon={SEVERITY_ICON.error} className="h-3.5 w-3.5" />
          {errors} {errors === 1 ? 'error' : 'errors'}
        </span>
      )}
      {warnings > 0 && (
        <span className="flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
          <Icon icon={SEVERITY_ICON.warning} className="h-3.5 w-3.5" />
          {warnings} {warnings === 1 ? 'warning' : 'warnings'}
        </span>
      )}
    </span>
  )
}
