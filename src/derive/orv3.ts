import { catalog } from '../model/catalog'
import type { RackWidth } from '../model/plan'

/** Shared BOM sizing and reservation notice. Height remains the user's usable
 * equipment height; infrastructure is not placed in the equipment elevation. */
export function orv3Infrastructure(rack: { widthInches: RackWidth; powerWatts: number }) {
  if (rack.widthInches !== 21) return undefined
  const frameId = 'rack-gigabyte-doa3-st0'
  const shelfId = 'power-orv3-shelf-33kw'
  const inputCableSetId = 'power-orv3-input-cable-set'
  const capacityWatts = catalog[shelfId].powerCapacityWatts!
  const shelvesPerFeed = Math.ceil(rack.powerWatts / capacityWatts)
  const shelfCount = 2 * shelvesPerFeed
  const reservedHeightUnits = shelfCount * catalog[shelfId].heightUnits!
  return {
    frameId,
    shelfId,
    inputCableSetId,
    capacityWatts,
    shelvesPerFeed,
    shelfCount,
    reservedHeightUnits,
    usableHeightUnits: catalog[frameId].usableHeightUnits! - reservedHeightUnits,
  }
}
