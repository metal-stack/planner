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
        text: 'Applies to every physical rack in a rack group. Height is measured in U for 19-inch racks and OU for 21-inch ORV3 racks. Switching format keeps your server selections and height count; review compatibility and usable height. 19-inch equipment is supported in ORV3 racks with height-based adapter estimates added to the BOM. Each server group can override adapters per chassis for its rail kit. Power shelves, bus bars and any additional space for the selected mounting hardware must be planned separately.',
      }}
      onChange={(v) => onChange(v === '21' ? 21 : 19)}
    />
  )
}
