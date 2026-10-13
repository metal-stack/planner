import type { RackWidth } from '../../model/plan'
import { SelectField } from './fields'

export default function RackWidthField({
  value,
  onChange,
}: {
  value: RackWidth
  onChange: (width: RackWidth) => void
}) {
  return (
    <SelectField
      label="Rack format"
      value={String(value)}
      options={[
        { value: '19', label: '19″ EIA' },
        { value: '21', label: '21″ ORV3' },
      ]}
      info={{
        text: 'Applies to every physical rack in a rack group. Height is measured in U for 19-inch racks and OU for 21-inch ORV3 racks. Switching format keeps your server selections and height count; review compatibility and usable height. ORV3 power shelves, bus bars and 19-inch equipment adapters must be planned separately.',
      }}
      onChange={(v) => onChange(v === '21' ? 21 : 19)}
    />
  )
}
