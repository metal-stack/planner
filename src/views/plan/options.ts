import type { CatalogItem, NosOption } from '../../model/catalog'
import { catalog, cpuLabel, itemLabel, nosLabel } from '../../model/catalog'
import type { SelectOption, SelectOptionGroup } from './fields'

// How hardware is named in the plan editor's dropdowns: the vendor model
// designation (never the region-suffixed ordering code), with the caveats a
// planner needs to see before picking it. CPUs carry their core and thread
// counts: "EPYC 4344P (8C/16T)".
export function optionLabel(item: CatalogItem): string {
  const notes = [
    item.status === 'alpha' ? 'alpha' : '',
    item.availability === 'eol' ? 'end of life' : '',
    item.availability === 'withdrawn' ? 'withdrawn' : '',
  ].filter(Boolean)
  if (item.category === 'cpu') return cpuLabel(item, ...notes)
  return notes.length ? `${itemLabel(item.id)} (${notes.join(', ')})` : itemLabel(item.id)
}

/** Each model appears once. Retired hardware goes last; current ORV3 models
 * stay together even when support is alpha, which their option label retains. */
export function serverOptions(
  items: CatalogItem[],
  currentId?: string,
): (SelectOption | SelectOptionGroup)[] {
  const groups: SelectOptionGroup[] = [
    { label: 'ORV3', options: [] },
    { label: 'Standard Formfactor', options: [] },
    { label: 'Alpha', options: [] },
    { label: 'EOL Systems', options: [] },
  ]
  for (const item of items) {
    const group =
      item.availability === 'eol' || item.availability === 'withdrawn'
        ? groups[3]
        : item.rackWidthInches === 21
          ? groups[0]
          : item.status === 'alpha'
            ? groups[2]
            : groups[1]
    group.options.push({ value: item.id, label: optionLabel(item) })
  }
  const options: (SelectOption | SelectOptionGroup)[] = groups.filter(
    (group) => group.options.length > 0,
  )
  if (currentId && !items.some((item) => item.id === currentId)) {
    options.push({ value: currentId, label: `${itemLabel(currentId)} (incompatible)` })
  }
  return options
}

/** How a NOS is named in the dropdown, with the caveat that matters at the
 *  moment of choosing: Edgecore's distribution is verified by metal-stack
 *  but end-of-life; Broadcom's is current but not in that list. */
export function nosOptionLabel(option: NosOption): string {
  const note = option.verified
    ? catalog[option.licenses['100g']]?.availability === 'eol'
      ? 'end of life'
      : ''
    : 'not on the metal-stack list'
  return note ? `${nosLabel(option.id)} (${note})` : nosLabel(option.id)
}
