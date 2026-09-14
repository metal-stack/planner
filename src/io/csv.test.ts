import { describe, expect, it } from 'vitest'
import { bomToCsv } from './csv'

describe('bomToCsv', () => {
  it('quotes fields containing commas and escapes quotes', () => {
    const csv = bomToCsv([
      {
        category: 'switch',
        catalogId: 'x',
        vendor: 'Edgecore',
        model: 'AS7726-32X',
        partNumber: 'A,B',
        description: 'a "quoted" description',
        quantity: 2,
        reasons: [{ quantity: 2, detail: 'two of them', where: 'Rack 1' }],
      },
    ])
    const lines = csv.trimEnd().split('\r\n')
    expect(lines[0]).toBe('Category,Vendor,Model,Part Number,Description,Quantity,Derived from')
    expect(lines[1]).toBe(
      'switch,Edgecore,AS7726-32X,"A,B","a ""quoted"" description",2,Rack 1: 2 (two of them)',
    )
  })

  it('appends price columns when a price book is given', () => {
    const csv = bomToCsv(
      [{ category: 'cable', catalogId: 'c', description: 'cable', quantity: 3, reasons: [] }],
      { currency: 'EUR', prices: { c: 2.5 } },
    )
    const lines = csv.trimEnd().split('\r\n')
    expect(lines[0]).toBe(
      'Category,Vendor,Model,Part Number,Description,Quantity,Derived from,' +
        'Unit price (EUR),Total (EUR)',
    )
    expect(lines[1]).toBe('cable,,,,cable,3,,2.5,7.5')
  })
})
