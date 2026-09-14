// Links into the metal-stack documentation used by the info bubbles.
// Keep these to pages that exist on docs.metal-stack.io (verified when
// added); the app never fetches them, they only open in a new tab.
export const DOCS = {
  architecture: 'https://docs.metal-stack.io/docs/architecture',
  networking: 'https://docs.metal-stack.io/docs/networking',
  networkSegmentation: 'https://docs.metal-stack.io/docs/network-segmentation',
  hardware: 'https://docs.metal-stack.io/docs/hardware',
  metalBmc: 'https://docs.metal-stack.io/docs/references/metal-bmc',
  rackSpreading: 'https://metal-stack.io/community/MEP-12-rack-spreading',
} as const

export interface Info {
  text: string
  /** Documentation page to read more. */
  href?: string
  linkLabel?: string
}
