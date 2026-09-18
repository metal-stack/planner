import { z } from 'zod'

// Inputs of the Ansible export (Ansible tab) that the plan cannot derive.
// Everything else in the generated inventory (hostnames, ASNs, addresses,
// DHCP ranges) comes from the plan and the IP plan in src/derive/ansible/.
//
// Role versions default to the pins in metal-stack/mini-lab's
// requirements.yaml, the CI image to the one metal-stack deployment
// repositories use, name and NTP servers to the public ones mini-lab and
// metal-roles use (checked 2026-09-18). Only the release vector version
// and the metal-api address are left for the operator; the export marks
// them as placeholders.

/** Public resolvers, as in mini-lab. */
export const PUBLIC_NAMESERVERS = ['1.1.1.1', '8.8.8.8']
/** The NTP pool's European servers, as in metal-roles. */
export const PUBLIC_NTP_SERVERS = [
  '0.europe.pool.ntp.org',
  '1.europe.pool.ntp.org',
  '2.europe.pool.ntp.org',
  '3.europe.pool.ntp.org',
]

export const CiPlatformSchema = z.enum(['gitlab', 'github', 'both', 'none'])
export type CiPlatform = z.infer<typeof CiPlatformSchema>

/** CI/CD pipelines that check and deploy the playbooks (derive/ansible/ci.ts). */
export const CiSchema = z.object({
  platform: CiPlatformSchema.default('gitlab'),
  /** Container image with Ansible, used by every job. */
  image: z.string().default('ghcr.io/metal-stack/metal-deployment-base:v0.7.7'),
  /** Deploys run from this branch only. */
  branch: z.string().default('main'),
  /** Runner tag (GitLab) / label (GitHub) per partition id; empty uses the
   *  partition's slug. Runners must reach the partition's management network. */
  runnerTags: z.record(z.string(), z.string()).default({}),
  /** SSH user for all hosts (ANSIBLE_REMOTE_USER); empty keeps Ansible's default. */
  sshUser: z.string().default(''),
  /** Verify SSH host keys (SSH_KNOWN_HOSTS then holds them). */
  hostKeyChecking: z.boolean().default(true),
  /** Offer a dry run (--check --diff) before deploying. */
  dryRun: z.boolean().default(true),
})
export type Ci = z.infer<typeof CiSchema>

export const DeploymentSchema = z.object({
  /** Inventory directory name (inventories/<environment>/). */
  environment: z.string().default('prod'),
  /** First ASN of the private 4-byte range (RFC 6996); see derive/devices.ts. */
  asnBase: z.number().int().min(4200000000).max(4294967294).default(4200000000),
  timezone: z.string().default('Europe/Berlin'),
  nameservers: z.array(z.string()).default(() => [...PUBLIC_NAMESERVERS]),
  ntpServers: z.array(z.string()).default(() => [...PUBLIC_NTP_SERVERS]),
  /** Ranges the switches accept SSH from on their production addresses. */
  sshSourceRanges: z.array(z.string()).default([]),
  /** metal-stack release (tag of github.com/metal-stack/releases). */
  metalStackRelease: z.string().default(''),
  /** Address of the control plane's metal-api (metal_partition_metal_api_addr). */
  metalApiAddress: z.string().default(''),
  ansibleCommonVersion: z.string().default('v0.7.4'),
  metalRolesVersion: z.string().default('v0.17.26'),
  ci: CiSchema.default(() => CiSchema.parse({})),
})
export type Deployment = z.infer<typeof DeploymentSchema>

export function defaultDeployment(): Deployment {
  return DeploymentSchema.parse({})
}

/** Runner tag of a partition: the override, else its slug. */
export function runnerTag(ci: Ci, partitionId: string, slug: string): string {
  return ci.runnerTags[partitionId]?.trim() || slug
}
