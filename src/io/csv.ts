import { formatReasons, type BomLine } from '../derive/bom'
import { lineTotal, unitPrice, type PriceBook } from './priceBook'

export function escapeField(value: string | number): string {
  const s = String(value)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** With a price book, unit price and line total columns are appended. */
export function bomToCsv(lines: BomLine[], prices?: PriceBook): string {
  const header = [
    'Category',
    'Vendor',
    'Model',
    'Part Number',
    'Description',
    'Quantity',
    'Derived from',
  ]
  if (prices) header.push(`Unit price (${prices.currency})`, `Total (${prices.currency})`)
  const rows = lines.map((l) => {
    const row: (string | number)[] = [
      l.category,
      l.vendor ?? '',
      l.model ?? '',
      l.partNumber ?? '',
      l.description,
      l.quantity,
      formatReasons(l.reasons),
    ]
    if (prices) row.push(unitPrice(prices, l) ?? '', lineTotal(prices, l) ?? '')
    return row
  })
  return [header, ...rows].map((row) => row.map(escapeField).join(',')).join('\r\n') + '\r\n'
}
