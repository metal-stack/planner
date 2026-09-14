import { useToastStore } from '../store/toastStore'
import { ACTION_ICON, Icon, SEVERITY_ICON } from './icons'

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  if (toasts.length === 0) return null

  return (
    <div className="fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm shadow-lg ${
            t.kind === 'error'
              ? 'border-red-300 bg-red-50 text-red-900'
              : 'border-ink bg-ink text-white'
          }`}
        >
          {t.kind === 'error' && (
            <Icon icon={SEVERITY_ICON.error} className="h-4 w-4 text-red-600" />
          )}
          <span className="flex-1">{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.onClick()
                dismiss(t.id)
              }}
              className="font-semibold text-brand underline-offset-2 hover:underline"
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="opacity-60 hover:opacity-100"
          >
            <Icon icon={ACTION_ICON.close} />
          </button>
        </div>
      ))}
    </div>
  )
}
