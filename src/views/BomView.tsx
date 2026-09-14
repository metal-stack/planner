import { useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  deriveBom,
  deriveBomByPartition,
  reasonsByWhere,
  SPARE_CATEGORY,
  type BomLine,
  type BomScope,
} from '../derive/bom'
import { bomToCsv } from '../io/csv'
import { downloadBlob, downloadText } from '../io/download'
import {
  exportPriceBookJson,
  formatMoney,
  importPriceBookJson,
  lineTotal,
  priceKey,
  unitPrice,
} from '../io/priceBook'
import { bomToXlsxBlob } from '../io/xlsx'
import { usePlanStore } from '../store/planStore'
import { usePriceStore } from '../store/priceStore'
import { useToastStore } from '../store/toastStore'
import { NumberField, SelectField } from './plan/fields'
import { ACTION_ICON, CATEGORY_ICON, Icon } from './icons'

/** Network scopes, mirroring the topology view's modes. A line can have
 *  contributions from both networks, so the quantities are filtered per
 *  contributing rule in deriveBom — the two scopes add up to "All". */
const scopes: { scope: BomScope; label: string; hint: string }[] = [
  { scope: 'all', label: 'All', hint: 'Everything the plan needs' },
  {
    scope: 'production',
    label: 'Production',
    hint: 'Fabric switches, routers, servers and their optics and cables',
  },
  {
    scope: 'management',
    label: 'Management',
    hint: 'Mgmt switches and servers, OOB copper and the mgmt fiber',
  },
]

/** Lines grouped by category, in the builder's sort order. */
function groupByCategory(lines: BomLine[]): { category: string; lines: BomLine[] }[] {
  const groups: { category: string; lines: BomLine[] }[] = []
  for (const line of lines) {
    const last = groups[groups.length - 1]
    if (last && last.category === line.category) last.lines.push(line)
    else groups.push({ category: line.category, lines: [line] })
  }
  return groups
}

/** Who makes the item, for the description cell: the vendor, plus the model
 *  only when it says more than the adjacent Part Number column already
 *  does (they are the same string for most items). */
function identity(line: BomLine): string {
  const model = line.model && line.model !== line.partNumber ? line.model : undefined
  return [line.vendor, model].filter(Boolean).join(' ')
}

/** Sum of priced lines; `complete` is false when any line has no price. */
function sumTotals(
  lines: BomLine[],
  book: { currency: string; prices: Record<string, number> },
): { total: number; complete: boolean } {
  let total = 0
  let complete = true
  for (const line of lines) {
    const t = lineTotal(book, line)
    if (t === undefined) complete = false
    else total += t
  }
  return { total, complete }
}

export default function BomView() {
  const plan = usePlanStore((s) => s.plan)
  const setSparesPerLine = usePlanStore((s) => s.setSparesPerLine)
  const book = usePriceStore(useShallow((s) => ({ currency: s.currency, prices: s.prices })))
  const setPrice = usePriceStore((s) => s.setPrice)
  const setCurrency = usePriceStore((s) => s.setCurrency)
  const replaceBook = usePriceStore((s) => s.replaceBook)
  const notify = useToastStore((s) => s.notify)
  const [scope, setScope] = useState<string>('')
  const [network, setNetwork] = useState<BomScope>('all')
  const [showReasons, setShowReasons] = useState(false)
  const [showPrices, setShowPrices] = useState(false)
  const priceFile = useRef<HTMLInputElement>(null)

  const byPartition = deriveBomByPartition(plan, network)
  const scoped = byPartition.find((b) => b.partition.id === scope)
  const bom = scoped ? scoped.lines : deriveBom(plan, network)
  // The network is part of the title so exported files say what they hold.
  const what = network === 'all' ? 'BOM' : `${network} BOM`
  const title = scoped ? `${plan.name} ${scoped.partition.name} ${what}` : `${plan.name} ${what}`
  const groups = groupByCategory(bom)
  const prices = showPrices ? book : undefined
  const grand = sumTotals(bom, book)
  const money = (n: number) => formatMoney(n, book.currency)

  async function exportXlsx() {
    downloadBlob(await bomToXlsxBlob(bom, prices), `${title}.xlsx`)
  }

  async function onImportPrices(file: File | undefined) {
    if (!file) return
    try {
      replaceBook(importPriceBookJson(await file.text()))
      notify('Price book imported.')
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), { kind: 'error' })
    }
  }

  const colSpan = 2 + (showReasons ? 1 : 0)

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="BOM scope"
          className="inline-flex rounded-md border border-gray-300 bg-white p-0.5"
        >
          {scopes.map((option) => (
            <button
              key={option.scope}
              type="button"
              onClick={() => setNetwork(option.scope)}
              title={option.hint}
              aria-pressed={network === option.scope}
              className={`rounded px-3 py-1 text-sm font-medium ${
                network === option.scope
                  ? 'bg-ink text-white'
                  : 'text-gray-600 hover:bg-brand-tint hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-500">
          {scopes.find((option) => option.scope === network)?.hint}
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {plan.partitions.length > 1 && (
          <div className="w-52">
            <SelectField
              label="Partition"
              value={scoped ? scope : ''}
              options={[
                { value: '', label: 'Whole plan' },
                ...plan.partitions.map((p) => ({ value: p.id, label: p.name })),
              ]}
              onChange={setScope}
            />
          </div>
        )}
        {!scoped && (
          <div className="w-44">
            <NumberField
              label="Spares per transceiver/cable line"
              value={plan.sparesPerLine}
              onChange={setSparesPerLine}
            />
          </div>
        )}
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={showReasons}
            onChange={(e) => setShowReasons(e.target.checked)}
          />
          Show derivation
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={showPrices}
            onChange={(e) => setShowPrices(e.target.checked)}
          />
          Show prices
        </label>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => downloadText(bomToCsv(bom, prices), `${title}.csv`, 'text/csv')}
            className="btn-primary"
          >
            <Icon icon={ACTION_ICON.download} />
            Export CSV
          </button>
          <button onClick={() => void exportXlsx()} className="btn-primary">
            <Icon icon={ACTION_ICON.download} />
            Export XLSX
          </button>
        </div>
      </div>
      {scoped && (
        <p className="text-xs text-gray-500">
          Per-partition BOMs exclude spares; spares are added to the whole-plan BOM only.
        </p>
      )}
      {showPrices && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-gray-200 bg-white px-3 py-2">
          <label className="block text-sm">
            <span className="mb-1 block text-gray-600">Currency</span>
            <input
              type="text"
              value={book.currency}
              maxLength={8}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              className="w-24 rounded-md border border-gray-300 bg-white px-2 py-1.5"
            />
          </label>
          <p className="pb-2 text-xs text-gray-500">
            Prices are stored in this browser, separate from the plan. Unit prices apply per catalog
            item; spares use their base item's price.
          </p>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() =>
                downloadText(exportPriceBookJson(book), 'price-book.json', 'application/json')
              }
              className="btn-secondary"
            >
              <Icon icon={ACTION_ICON.download} />
              Export price book
            </button>
            <button
              type="button"
              onClick={() => priceFile.current?.click()}
              className="btn-secondary"
            >
              <Icon icon={ACTION_ICON.upload} />
              Import price book
            </button>
            <input
              ref={priceFile}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                void onImportPrices(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
        </div>
      )}

      <table className="card w-full border-collapse overflow-hidden text-sm">
        <thead>
          <tr className="border-b border-gray-300 text-left">
            <th className="px-3 py-2">Part Number</th>
            <th className="px-3 py-2">Description</th>
            {showReasons && <th className="px-3 py-2">Derived from</th>}
            <th className="px-3 py-2 text-right">Qty</th>
            {showPrices && <th className="px-3 py-2 text-right">Unit price</th>}
            {showPrices && <th className="px-3 py-2 text-right">Total</th>}
          </tr>
        </thead>
        {groups.map((group) => {
          const sub = sumTotals(group.lines, book)
          return (
            <tbody key={group.category}>
              <tr className="border-y border-gray-200 bg-gray-50">
                <th
                  colSpan={colSpan}
                  className="px-3 py-1.5 text-left text-xs font-semibold text-gray-600 uppercase"
                >
                  <Icon
                    icon={
                      CATEGORY_ICON[group.category as keyof typeof CATEGORY_ICON] ??
                      CATEGORY_ICON.spare
                    }
                    className="mr-1.5 inline h-3.5 w-3.5 align-[-2px] text-gray-500"
                  />
                  {group.category}
                  <span className="ml-2 font-normal text-gray-500 normal-case">
                    {group.lines.length} {group.lines.length === 1 ? 'line' : 'lines'}
                  </span>
                </th>
                <th className="px-3 py-1.5 text-right text-xs font-semibold text-gray-600 tabular-nums">
                  {group.lines.reduce((n, l) => n + l.quantity, 0)}
                </th>
                {showPrices && <th />}
                {showPrices && (
                  <th className="px-3 py-1.5 text-right text-xs font-semibold text-gray-600 tabular-nums">
                    {sub.complete
                      ? money(sub.total)
                      : sub.total > 0
                        ? `≥ ${money(sub.total)}`
                        : '—'}
                  </th>
                )}
              </tr>
              {group.lines.map((line) => {
                const price = unitPrice(book, line)
                const total = lineTotal(book, line)
                const isSpare = line.category === SPARE_CATEGORY
                return (
                  <tr
                    key={line.catalogId}
                    className={`border-b border-gray-100 ${isSpare ? 'text-gray-500' : ''}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{line.partNumber ?? '—'}</td>
                    <td className="px-3 py-2">
                      {identity(line) && <span className="font-medium">{identity(line)} </span>}
                      <span className={identity(line) ? 'text-gray-500' : ''}>
                        {line.description}
                      </span>
                    </td>
                    {showReasons && (
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {reasonsByWhere(line.reasons).map((group) => (
                          <div key={group.where} className="mb-1 last:mb-0">
                            {group.where && (
                              <div className="font-medium text-gray-600">{group.where}</div>
                            )}
                            {group.reasons.map((reason, i) => (
                              <div key={i} className="flex gap-1.5">
                                <span className="w-10 shrink-0 text-right tabular-nums">
                                  {reason.quantity}
                                </span>
                                <span>{reason.detail}</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right tabular-nums">{line.quantity}</td>
                    {showPrices && (
                      <td className="px-3 py-1 text-right">
                        {isSpare ? (
                          <span className="text-xs text-gray-400">
                            {price === undefined ? '—' : money(price)}
                          </span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={price ?? ''}
                            placeholder="—"
                            aria-label={`Unit price for ${line.model ?? line.partNumber ?? line.description}`}
                            onChange={(e) =>
                              setPrice(
                                priceKey(line),
                                e.target.value === '' ? undefined : Number(e.target.value),
                              )
                            }
                            className="w-28 rounded-md border border-gray-300 bg-white px-2 py-1 text-right tabular-nums"
                          />
                        )}
                      </td>
                    )}
                    {showPrices && (
                      <td className="px-3 py-2 text-right tabular-nums">
                        {total === undefined ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          money(total)
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          )
        })}
        {showPrices && (
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <td colSpan={colSpan + 2} className="px-3 py-2 text-right">
                {grand.complete ? 'Total' : 'Total of priced lines'}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{money(grand.total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
