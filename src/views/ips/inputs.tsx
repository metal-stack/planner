import { parseCidr, type Family } from '../../derive/ip/cidr'
import { ACTION_ICON, Icon } from '../icons'

/** CIDR text input with inline parse errors; a host-bits error offers the
 *  network address as a one-click fix. */
export function CidrInput({
  id,
  value,
  family,
  onChange,
}: {
  id?: string
  value: string
  family: Family
  onChange: (value: string) => void
}) {
  const result = parseCidr(value, family)
  return (
    <div>
      <input
        id={id}
        type="text"
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-md border bg-white px-2 py-1.5 font-mono text-sm ${
          result.ok ? 'border-gray-300' : 'border-red-400'
        }`}
      />
      {!result.ok && (
        <p className="mt-1 text-xs text-red-700">
          {result.error}
          {result.suggestion && (
            <>
              {' '}
              <button
                type="button"
                onClick={() => onChange(result.suggestion!)}
                className="font-medium underline"
              >
                Use {result.suggestion}
              </button>
            </>
          )}
        </p>
      )}
    </div>
  )
}

export function CidrListInput({
  idPrefix,
  values,
  family,
  addLabel,
  onChange,
}: {
  idPrefix: string
  values: string[]
  family: Family
  addLabel: string
  onChange: (values: string[]) => void
}) {
  return (
    <div className="space-y-1.5">
      {values.map((v, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1">
            <CidrInput
              id={`${idPrefix}-${i}`}
              value={v}
              family={family}
              onChange={(nv) => onChange(values.map((x, j) => (j === i ? nv : x)))}
            />
          </div>
          <button
            type="button"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
            aria-label="Remove range"
            className="mt-2 px-1 text-gray-400 hover:text-red-700"
          >
            <Icon icon={ACTION_ICON.close} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...values, ''])}
        className="inline-flex items-center gap-1 text-xs font-medium text-brand-strong hover:underline"
      >
        <Icon icon={ACTION_ICON.add} className="h-3.5 w-3.5" />
        {addLabel}
      </button>
    </div>
  )
}

/** Prefix length input shown as "/22". */
export function PrefixInput({
  id,
  value,
  max,
  onChange,
}: {
  id?: string
  value: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex items-center rounded-md border border-gray-300 bg-white">
      <span className="pl-2 font-mono text-sm text-gray-500">/</span>
      <input
        id={id}
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isInteger(n) && n >= 0 && n <= max) onChange(n)
        }}
        className="w-full rounded-md bg-white py-1.5 pr-2 pl-0.5 font-mono text-sm tabular-nums"
      />
    </div>
  )
}
