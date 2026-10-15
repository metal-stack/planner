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
        text: 'Applies to every physical rack in a rack group. Height is measured in U for 19-inch racks and OU for 21-inch ORV3 racks. Switching format keeps your server selections and height count; review compatibility and usable height. The BOM includes a rack frame with bus bar and populated power shelves sized N+N to each physical rack’s estimated server, GPU and switch load, plus AC input cable sets. Empty racks need no power shelves. These shared items appear under Production. Reserve power-shelf space outside the equipment elevation. 19-inch equipment needs mounting adapters: one kit for 1U devices and two for 2U and taller. Allow any extra mounting space and confirm site feeds and AC distribution with the supplier. Battery backup is optional and excluded.',
      }}
      onChange={(v) => onChange(v === '21' ? 21 : 19)}
    />
  )
}
