import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { emptyPriceBook, PriceBookSchema, type PriceBook } from '../io/priceBook'

// Prices are UI-side data separate from the plan (see io/priceBook.ts).
// Persisted under their own key so plan files never carry prices.

interface PriceState extends PriceBook {
  setPrice: (catalogId: string, price: number | undefined) => void
  setCurrency: (currency: string) => void
  replaceBook: (book: PriceBook) => void
  clear: () => void
}

export const usePriceStore = create<PriceState>()(
  persist(
    (set) => ({
      ...emptyPriceBook(),
      setPrice: (catalogId, price) =>
        set((s) => {
          const prices = { ...s.prices }
          if (price === undefined || Number.isNaN(price)) delete prices[catalogId]
          else prices[catalogId] = price
          return { prices }
        }),
      setCurrency: (currency) => set({ currency }),
      replaceBook: (book) => set({ currency: book.currency, prices: book.prices }),
      clear: () => set(emptyPriceBook()),
    }),
    {
      name: 'metal-stack-planner/prices',
      version: 1,
      partialize: (s) => ({ currency: s.currency, prices: s.prices }),
      merge: (persisted, current) => {
        const parsed = PriceBookSchema.safeParse(persisted)
        return { ...current, ...(parsed.success ? parsed.data : emptyPriceBook()) }
      },
    },
  ),
)
