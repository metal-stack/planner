import { z } from 'zod'
import type { BomLine } from '../derive/bom'

// The price book is kept apart from the plan: plan files stay price-free,
// prices live in their own localStorage entry and JSON file, keyed by
// catalog id. Spare lines ("<id>#spare") use the price of their base item.

export const PriceBookSchema = z.object({
  currency: z.string().min(1).max(8).default('EUR'),
  prices: z.record(z.string(), z.number().nonnegative()),
})
export type PriceBook = z.infer<typeof PriceBookSchema>

export function emptyPriceBook(): PriceBook {
  return { currency: 'EUR', prices: {} }
}

/** Catalog id a BOM line is priced by (spares share their base item's price). */
export function priceKey(line: BomLine): string {
  return line.catalogId.split('#')[0]
}

export function unitPrice(book: PriceBook, line: BomLine): number | undefined {
  return book.prices[priceKey(line)]
}

export function lineTotal(book: PriceBook, line: BomLine): number | undefined {
  const price = unitPrice(book, line)
  return price === undefined ? undefined : price * line.quantity
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

export function exportPriceBookJson(book: PriceBook): string {
  return JSON.stringify(book, null, 2)
}

export function importPriceBookJson(text: string): PriceBook {
  const result = PriceBookSchema.safeParse(JSON.parse(text))
  if (!result.success) {
    throw new Error(`Invalid price book: ${result.error.issues[0]?.message ?? 'unknown error'}`)
  }
  return result.data
}
