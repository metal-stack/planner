import { describe, expect, it } from 'vitest'
import type { BomLine } from '../derive/bom'
import { exportPriceBookJson, importPriceBookJson, lineTotal, unitPrice } from './priceBook'

const line = (catalogId: string, quantity: number): BomLine => ({
  category: 'cable',
  catalogId,
  description: '',
  quantity,
  reasons: [],
})

describe('price book', () => {
  it('round-trips through JSON and rejects negative prices', () => {
    const book = { currency: 'EUR', prices: { 'switch-as7726': 4200 } }
    expect(importPriceBookJson(exportPriceBookJson(book))).toEqual(book)
    expect(() => importPriceBookJson('{"prices":{"x":-1}}')).toThrow('Invalid price book')
    // currency defaults
    expect(importPriceBookJson('{"prices":{}}').currency).toBe('EUR')
  })

  it('prices spare lines like their base item', () => {
    const book = { currency: 'EUR', prices: { 'cable-rj45': 5 } }
    expect(unitPrice(book, line('cable-rj45#spare', 2))).toBe(5)
    expect(lineTotal(book, line('cable-rj45#spare', 2))).toBe(10)
    expect(lineTotal(book, line('unknown', 2))).toBeUndefined()
  })
})
