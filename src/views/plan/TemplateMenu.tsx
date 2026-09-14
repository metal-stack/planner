import { templates } from '../../model/templates'
import { usePlanStore } from '../../store/planStore'
import { useToastStore } from '../../store/toastStore'
import MenuButton from '../MenuButton'
import { ACTION_ICON } from '../icons'

/** "Templates" dropdown: loads a starting plan, replacing the current one
 *  (undoable, so no confirmation). */
export default function TemplateMenu() {
  const replacePlan = usePlanStore((s) => s.replacePlan)
  const notify = useToastStore((s) => s.notify)
  return (
    <MenuButton
      label="Templates"
      icon={ACTION_ICON.templates}
      items={templates}
      onSelect={(item) => {
        const t = templates.find((x) => x.id === item.id)!
        replacePlan(t.build())
        notify(`Loaded template "${t.name}".`, {
          action: { label: 'Undo', onClick: () => usePlanStore.temporal.getState().undo() },
        })
      }}
    />
  )
}
