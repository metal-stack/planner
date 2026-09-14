import { create } from 'zustand'

// Transient in-app notifications, replacing window.alert/confirm. Toasts
// are UI state only and never persisted. Destructive actions (reset,
// import) don't ask for confirmation — they notify with an Undo action
// instead, since every plan change is undoable.

export interface Toast {
  id: number
  kind: 'info' | 'error'
  message: string
  action?: { label: string; onClick: () => void }
}

interface ToastState {
  toasts: Toast[]
  notify: (message: string, opts?: { kind?: Toast['kind']; action?: Toast['action'] }) => void
  dismiss: (id: number) => void
}

const TOAST_MS = 7000
let nextId = 1

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  notify: (message, opts) => {
    const id = nextId++
    set((s) => ({
      toasts: [...s.toasts, { id, message, kind: opts?.kind ?? 'info', action: opts?.action }],
    }))
    setTimeout(() => get().dismiss(id), TOAST_MS)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
