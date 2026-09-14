import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Small bits of UI state that outlive a reload but are neither part of the
// plan nor of the price book (see planStore.ts / priceStore.ts), so they get
// their own key.

interface UiState {
  /** The intro card on the Plan tab is onboarding: once dismissed, stay gone. */
  introDismissed: boolean
  dismissIntro: () => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      introDismissed: false,
      dismissIntro: () => set({ introDismissed: true }),
    }),
    {
      name: 'metal-stack-planner/ui',
      version: 1,
      partialize: (s) => ({ introDismissed: s.introDismissed }),
    },
  ),
)
