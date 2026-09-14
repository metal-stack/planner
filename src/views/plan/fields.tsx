import type { ReactNode } from 'react'
import type { Info } from './docs'
import InfoBubble from './InfoBubble'

interface Option {
  value: string
  label: string
}

function FieldLabel({
  label,
  info,
  action,
}: {
  label: string
  info?: Info
  /** Small control shown next to the label, e.g. a fill-in shortcut. */
  action?: ReactNode
}) {
  return (
    <span className="mb-1 flex items-center gap-1 text-gray-600">
      {label}
      {info && <InfoBubble info={info} label={label} />}
      {action}
    </span>
  )
}

export function SelectField(props: {
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  info?: Info
}) {
  return (
    <label className="block text-sm">
      <FieldLabel label={props.label} info={props.info} />
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5"
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function NumberField(props: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  /** Arrow-key / spinner increment (e.g. nodes per chassis). */
  step?: number
  info?: Info
  action?: ReactNode
}) {
  return (
    <label className="block text-sm">
      <FieldLabel label={props.label} info={props.info} action={props.action} />
      <input
        type="number"
        min={props.min ?? 0}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isInteger(n) && n >= (props.min ?? 0)) props.onChange(n)
        }}
        className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 tabular-nums"
      />
    </label>
  )
}
