import { catalog } from '../model/catalog'
import type { RackWidth } from '../model/plan'

/** Shared sizing for the BOM, rack diagram and height validation. */
export function orv3Infrastructure(rack: { widthInches: RackWidth; powerWatts: number }) {
  if (rack.widthInches !== 21) return undefined
  const frameId = 'rack-gigabyte-doa3-st0'
  const shelfId = 'power-orv3-shelf'
  const inputCableSetId = 'power-orv3-input-cable-set'
  const shelf = catalog[shelfId]
  const psuId = shelf.psuModelId!
  const blankId = shelf.psuBlankModelId!
  const psuSlots = shelf.psuSlots!
  const psuCapacityWatts = catalog[psuId].powerCapacityWatts!
  const capacityWatts = psuSlots * psuCapacityWatts
  // Each feed can independently carry the estimated load. Populate only the
  // modules needed, filling shelves in order; cover the remaining PSU slots.
  const psusPerFeed = Math.ceil(rack.powerWatts / psuCapacityWatts)
  const shelvesPerFeed = Math.ceil(psusPerFeed / psuSlots)
  const psusPerShelf = Array.from({ length: shelvesPerFeed }, (_, i) =>
    Math.min(psuSlots, psusPerFeed - i * psuSlots),
  )
  const shelfCount = 2 * shelvesPerFeed
  const psuCount = 2 * psusPerFeed
  const blankCount = shelfCount * psuSlots - psuCount
  const reservedHeightUnits = shelfCount * catalog[shelfId].heightUnits!
  return {
    frameId,
    shelfId,
    inputCableSetId,
    psuId,
    blankId,
    psuSlots,
    psuCapacityWatts,
    psusPerFeed,
    psusPerShelf,
    psuCount,
    blankCount,
    capacityWatts,
    shelvesPerFeed,
    shelfCount,
    reservedHeightUnits,
    usableHeightUnits: catalog[frameId].usableHeightUnits!,
  }
}
