import { z } from 'zod'

// Inputs of the Ansible export (Ansible tab) that the plan cannot derive.
// Everything else in the generated inventory (hostnames, ASNs, addresses,
// DHCP ranges) comes from the plan and the IP plan in src/derive/ansible/.
//
// Role versions default to the pins in metal-stack/mini-lab's
// requirements.yaml (checked 2026-09-18); the release vector version is
// left for the operator, the export marks it as a placeholder.

export const DeploymentSchema = z.object({
  /** Inventory directory name (inventories/<environment>/). */
  environment: z.string().default('prod'),
  /** First ASN of the private 4-byte range (RFC 6996); see derive/devices.ts. */
  asnBase: z.number().int().min(4200000000).max(4294967294).default(4200000000),
  timezone: z.string().default('Europe/Berlin'),
  nameservers: z.array(z.string()).default([]),
  ntpServers: z.array(z.string()).default([]),
  /** Ranges the switches accept SSH from on their production addresses. */
  sshSourceRanges: z.array(z.string()).default([]),
  /** metal-stack release (tag of github.com/metal-stack/releases). */
  metalStackRelease: z.string().default(''),
  ansibleCommonVersion: z.string().default('v0.7.4'),
  metalRolesVersion: z.string().default('v0.17.26'),
})
export type Deployment = z.infer<typeof DeploymentSchema>

export function defaultDeployment(): Deployment {
  return DeploymentSchema.parse({})
}
