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
        text: 'Applies to every physical rack in a rack group. Height is measured in U for 19-inch racks and OU for 21-inch ORV3 racks. Switching format keeps your server selections and height count; review compatibility and usable height. The BOM includes a rack frame with bus bar and power shelves with PSU modules sized N+N to each physical rack’s estimated server, GPU and switch load, plus slot blanks and AC input cable sets. The diagram shows fitted PSU capacity per shelf; the rack power budget remains a separate limit. Empty racks need no power shelves. These shared items appear under Production. The rack diagram counts power shelves in used height. Enter mounting height including power shelves; do not subtract their space manually. 19-inch equipment needs mounting adapters: one kit for 1U devices and two for 2U and taller. Allow any extra mounting space and confirm site feeds and AC distribution with the supplier. Battery backup is optional and excluded.',
      }}
      onChange={(v) => onChange(v === '21' ? 21 : 19)}
    />
  )
}
