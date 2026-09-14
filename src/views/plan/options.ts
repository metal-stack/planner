import type { CatalogItem, NosOption } from '../../model/catalog'
import { catalog, itemLabel, nosLabel } from '../../model/catalog'

// How hardware is named in the plan editor's dropdowns: the vendor model
// designation (never the region-suffixed ordering code), with the caveats a
// planner needs to see before picking it.
export function optionLabel(item: CatalogItem): string {
  const notes = [
    item.status === 'alpha' ? 'alpha' : '',
    item.availability === 'eol' ? 'end of life' : '',
    item.availability === 'withdrawn' ? 'withdrawn' : '',
  ].filter(Boolean)
  return notes.length ? `${itemLabel(item.id)} (${notes.join(', ')})` : itemLabel(item.id)
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
