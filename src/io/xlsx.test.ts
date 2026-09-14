import { describe, expect, it } from 'vitest'
import type { BomLine } from '../derive/bom'
import { bomToXlsxBlob } from './xlsx'

// The workbook is built by exceljs, so what is worth asserting is that our
// column mapping is complete and in the documented order — a column added to
// `sheet.columns` but not to `addRow` silently exports an empty column.

const lines: BomLine[] = [
  {
    category: 'switch',
    catalogId: 'switch-as7726',
    vendor: 'Edgecore',
    model: 'AS7726-32X',
    partNumber: 'AS7726-32X',
    description: '32× 100G QSFP28',
    quantity: 4,
    reasons: [{ quantity: 4, detail: '4 spines', where: 'Central rack' }],
  },
  {
    category: 'cable',
    catalogId: 'cable-rj45',
    description: 'Cat6 patch, RJ45, 1G (OOB and management)',
    quantity: 12,
    reasons: [{ quantity: 12, detail: '12 server chassis × 1 BMC port', where: 'Rack 1' }],
  },
]

/** Reads the sheet back out of the produced workbook. */
async function rows(prices?: Parameters<typeof bomToXlsxBlob>[1]) {
  const blob = await bomToXlsxBlob(lines, prices)
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await blob.arrayBuffer())
  const sheet = workbook.getWorksheet('BOM')!
  const out: (string | number | null)[][] = []
  sheet.eachRow((row) => {
    // values is 1-based with a leading hole.
    out.push((row.values as (string | number | null)[]).slice(1))
  })
  return out
}

describe('bomToXlsxBlob', () => {
  it('produces an xlsx blob with a BOM sheet', async () => {
    const blob = await bomToXlsxBlob(lines)
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(blob.size).toBeGreaterThan(0)
  })

  it('writes the documented header order', async () => {
    const [header] = await rows()
    expect(header).toEqual([
      'Category',
      'Vendor',
      'Model',
      'Part Number',
      'Description',
      'Quantity',
      'Derived from',
    ])
  })

  it('maps every column, leaving unknown vendor and model blank', async () => {
    const [, sw, cable] = await rows()
    expect(sw).toEqual([
      'switch',
      'Edgecore',
      'AS7726-32X',
      'AS7726-32X',
      '32× 100G QSFP28',
      4,
      'Central rack: 4 (4 spines)',
    ])
    expect(cable).toEqual([
      'cable',
      '',
      '',
      '',
      'Cat6 patch, RJ45, 1G (OOB and management)',
      12,
      'Rack 1: 12 (12 server chassis × 1 BMC port)',
    ])
  })

  it('appends price columns only when a price book is given', async () => {
    const [header, sw] = await rows({
      currency: 'EUR',
      prices: { 'switch-as7726': 1000 },
    })
    expect(header.slice(-2)).toEqual(['Unit price (EUR)', 'Total (EUR)'])
    expect(sw.slice(-2)).toEqual([1000, 4000])
  })
})
