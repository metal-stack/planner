import { formatReasons, type BomLine } from '../derive/bom'
import { lineTotal, unitPrice, type PriceBook } from './priceBook'

export async function bomToXlsxBlob(lines: BomLine[], prices?: PriceBook): Promise<Blob> {
  // exceljs is ~1MB minified — load it only when an export actually happens.
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('BOM')

  sheet.columns = [
    { header: 'Category', key: 'category', width: 14 },
    { header: 'Vendor', key: 'vendor', width: 14 },
    { header: 'Model', key: 'model', width: 24 },
    { header: 'Part Number', key: 'partNumber', width: 24 },
    { header: 'Description', key: 'description', width: 64 },
    { header: 'Quantity', key: 'quantity', width: 10 },
    { header: 'Derived from', key: 'reasons', width: 60 },
    ...(prices
      ? [
          { header: `Unit price (${prices.currency})`, key: 'unitPrice', width: 16 },
          { header: `Total (${prices.currency})`, key: 'total', width: 16 },
        ]
      : []),
  ]
  sheet.getRow(1).font = { bold: true }

  for (const line of lines) {
    sheet.addRow({
      category: line.category,
      vendor: line.vendor ?? '',
      model: line.model ?? '',
      partNumber: line.partNumber ?? '',
      description: line.description,
      quantity: line.quantity,
      reasons: formatReasons(line.reasons),
      ...(prices ? { unitPrice: unitPrice(prices, line), total: lineTotal(prices, line) } : {}),
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
