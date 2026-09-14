import type { IssueTarget } from '../../derive/validate'
import { usePlanStore } from '../../store/planStore'

// Editor section anchors. Issues carry a structured target; these map it
// to the DOM id of the section that can fix it, so the side panel can
// scroll there and flash it.

export const fabricAnchor = (partitionId: string) => `fabric-${partitionId}`
export const rackAnchor = (rackId: string) => `rack-${rackId}`

/** Anchor of an IPs-tab field ("ipv4.shootPodCidr" → "ip-ipv4-shootPodCidr"). */
export const ipFieldAnchor = (field: string) => `ip-${field.replace(/\./g, '-')}`

export function anchorFor(target: IssueTarget): string | undefined {
  if (target.section === 'ips') return ipFieldAnchor(target.field ?? 'top')
  if (target.rackId) return rackAnchor(target.rackId)
  if (target.partitionId) return fabricAnchor(target.partitionId)
  return undefined
}

const FLASH_MS = 1600

export function revealSection(anchor: string | undefined): void {
  if (!anchor) return
  const el = document.getElementById(anchor)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.remove('section-flash')
  // Restart the animation even when the same section is flashed twice.
  void el.offsetWidth
  el.classList.add('section-flash')
  setTimeout(() => el.classList.remove('section-flash'), FLASH_MS)
}

/** Opens the tab an issue or diagram element belongs to and reveals its
 *  section (switching tabs first lets the section mount). */
export function navigateTo(target: IssueTarget): void {
  const anchor = anchorFor(target)
  const view = target.section === 'ips' ? 'ips' : 'plan'
  const store = usePlanStore.getState()
  if (store.activeView === view) {
    revealSection(anchor)
    return
  }
  store.setActiveView(view)
  setTimeout(() => revealSection(anchor), 30)
}
