import type { Plan } from '../../model/plan'
import { deriveDevices, slugify, type PartitionDevices } from '../devices'
import { deriveDeviceAddresses, type PartitionAddresses } from '../ip/deviceAddresses'
import { deriveIpPlan } from '../ip/ipPlan'
import { inventoryFile } from './inventory'
import { staticFiles, readme } from './playbooks'
import { groupVarFiles, hostVarFiles } from './vars'

// The Ansible export: an inventory, group and host variables for the
// metal-roles partition roles, and the playbooks that apply them, laid out
// like a metal-stack deployment repository:
//
//   README.md, ansible.cfg, requirements.yaml, deploy_*.yaml
//   inventories/<env>/inventory.yaml
//   inventories/<env>/group_vars/<group>/<topic>.yaml
//   inventories/<env>/host_vars/<host>.yaml
//
// Everything is derived from the plan (devices, addresses, ASNs, DHCP
// ranges); what the plan cannot know (secrets, API endpoints, interface
// names, switch port layouts) is written as CHANGE_ME and listed as a
// placeholder, in the view and in the generated README.

export const CHANGE_ME = 'CHANGE_ME'

export interface AnsibleFile {
  path: string
  content: string
}

export interface Placeholder {
  file: string
  key: string
  reason: string
}

export interface AnsibleExport {
  files: AnsibleFile[]
  placeholders: Placeholder[]
  /** Addresses that could not be handed out, and why. */
  notes: string[]
  devices: PartitionDevices[]
  addresses: PartitionAddresses[]
}

/** Collects files and placeholders while the generators run. */
export class AnsibleOut {
  readonly files: AnsibleFile[] = []
  readonly placeholders: Placeholder[] = []
  /** inventories/<env> */
  readonly inventory: string

  constructor(environment: string) {
    this.inventory = `inventories/${slugify(environment) || 'prod'}`
  }

  /** Records a placeholder and returns the marker to write in its place. */
  todo(file: string, key: string, reason: string): string {
    this.placeholders.push({ file, key, reason })
    return CHANGE_ME
  }

  add(path: string, content: string): void {
    this.files.push({ path, content })
  }
}

export function deriveAnsible(plan: Plan): AnsibleExport {
  const devices = deriveDevices(plan)
  const addresses = deriveDeviceAddresses(plan, deriveIpPlan(plan), devices)
  const out = new AnsibleOut(plan.deployment.environment)
  const ctx = { plan, devices, addresses, out }

  staticFiles(ctx)
  inventoryFile(ctx)
  groupVarFiles(ctx)
  hostVarFiles(ctx)
  const notes = addresses.flatMap((a) => a.notes)
  // The README lists the placeholders, so it comes last and goes first.
  out.files.unshift({ path: 'README.md', content: readme(ctx, notes) })
  return { files: out.files, placeholders: out.placeholders, notes, devices, addresses }
}

export interface AnsibleContext {
  plan: Plan
  devices: PartitionDevices[]
  addresses: PartitionAddresses[]
  out: AnsibleOut
}
