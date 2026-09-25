import { z } from 'zod'
import { defaultIpPlan, IpPlanSchema } from './ipPlan'
import { SCHEMA_VERSION } from './migrate'

// The Plan is the single document the whole app operates on. These Zod
// schemas are the source of truth — all TypeScript types are inferred from
// them, and every JSON import must pass PlanSchema before entering the store.

export const UplinkSpeedSchema = z.enum(['2x25G', '2x100G'])
export type UplinkSpeed = z.infer<typeof UplinkSpeedSchema>

/** Roles of server groups in compute racks. Management servers are not a
 *  group role — they live in the central rack (FabricConfig.mgmt). */
export const ServerRoleSchema = z.enum(['worker', 'storage'])
export type ServerRole = z.infer<typeof ServerRoleSchema>

export const FabricTypeSchema = z.enum(['leaf-spine', 'leaf-spine-superspine'])
export type FabricType = z.infer<typeof FabricTypeSchema>

export const MgmtLayerSchema = z.enum(['l2', 'l3'])
export type MgmtLayer = z.infer<typeof MgmtLayerSchema>

/** Network OS of a partition's switches; picks the NOS support license
 *  every switch gets in the BOM. Broadcom's distribution is the default:
 *  Edgecore's own is end-of-life at the vendor. */
export const NosSchema = z.enum(['broadcom-sonic', 'edgecore-sonic'])
export type Nos = z.infer<typeof NosSchema>

/** GPUs fitted to every node of a group. Absent means none; the server
 *  model's `gpuCapable` caps `perNode`. */
export const GpuConfigSchema = z.object({
  modelId: z.string(),
  perNode: z.number().int().min(1),
})
export type GpuConfig = z.infer<typeof GpuConfigSchema>

export const ServerGroupSchema = z.object({
  id: z.string(),
  role: ServerRoleSchema,
  /** Catalog id of the server model (nodes, not chassis — chassis count is derived). */
  modelId: z.string(),
  /** Number of server nodes in this group. */
  count: z.number().int().min(0),
  uplink: UplinkSpeedSchema,
  gpu: GpuConfigSchema.optional(),
})
export type ServerGroup = z.infer<typeof ServerGroupSchema>

/** 'rack-group': one entity of three physical racks sharing the middle
 *  rack's leaf pair and mgmt leaf — compute spreads middle, then left,
 *  then right. heightUnits applies per physical rack. */
export const RackKindSchema = z.enum(['single', 'rack-group'])
export type RackKind = z.infer<typeof RackKindSchema>

/** Defaults a partition applies to racks it creates; each rack keeps its
 *  own copy and can override it in its Advanced section. */
export const RackDefaultsSchema = z.object({
  heightUnits: z.number().int().positive().default(42),
  maxPowerWatts: z.number().int().positive().default(10000),
})
export type RackDefaults = z.infer<typeof RackDefaultsSchema>

export const RackSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: RackKindSchema.default('single'),
  /** Names of a rack group's left, middle and right physical racks; `name`
   *  then names the group itself. Absent for a single rack. */
  memberNames: z.tuple([z.string(), z.string(), z.string()]).optional(),
  heightUnits: z.number().int().positive(),
  /** Power budget per physical rack, W; the estimate is checked against it. */
  maxPowerWatts: z.number().int().positive().default(10000),
  leafModelId: z.string(),
  leafCount: z.number().int().min(0),
  servers: z.array(ServerGroupSchema),
})
export type Rack = z.infer<typeof RackSchema>

/** The management network has its own topology: a flat L2 network or an L3
 *  (routed) fabric, redundant (2 mgmt spines / 2 mgmt servers) or not. */
export const MgmtNetworkSchema = z.object({
  layer: MgmtLayerSchema.default('l3'),
  redundant: z.boolean().default(true),
  spineModelId: z.string().default('switch-as4630'),
  leafModelId: z.string().default('switch-as4630'),
  leafPerRack: z.number().int().min(0).default(1),
  serverModelId: z.string().default('server-mgmt-121h'),
})
export type MgmtNetwork = z.infer<typeof MgmtNetworkSchema>

/** Redundancy drives the count of mgmt spines and mgmt servers. */
export function mgmtDeviceCount(mgmt: MgmtNetwork): number {
  return mgmt.redundant ? 2 : 1
}

// New fields carry .default() so plan files exported before they existed
// still import (Zod fills the gaps); schemaVersion only changes for
// non-additive changes, which get a migration in model/migrate.ts.
export const FabricConfigSchema = z.object({
  fabricType: FabricTypeSchema.default('leaf-spine'),
  spineModelId: z.string(),
  spineCount: z.number().int().min(0),
  superspineModelId: z.string().default('switch-as7726'),
  superspineCount: z.number().int().min(0).default(0),
  exitModelId: z.string(),
  exitSwitchCount: z.number().int().min(0),
  /** Internet routers in the central rack, each linked twice to every exit. */
  routerCount: z.number().int().min(0).default(0),
  storageLeafModelId: z.string().default('switch-as7726'),
  storageLeafCount: z.number().int().min(0).default(0),
  mgmt: MgmtNetworkSchema.default({
    layer: 'l3',
    redundant: true,
    spineModelId: 'switch-as4630',
    leafModelId: 'switch-as4630',
    leafPerRack: 1,
    serverModelId: 'server-mgmt-121h',
  }),
  /** 100G links from every leaf to every spine (uplink bundle size). Every
   *  switch's single management interface connects to the management
   *  network on its own — that is not configurable. */
  leafSpineLinks: z.number().int().min(1).default(1),
  /** Require leaf → spine bandwidth to match the attached machines (1:1). */
  nonBlocking: z.boolean().default(false),
  /** Network OS of this partition's switches (drives the license lines). */
  nos: NosSchema.default('broadcom-sonic'),
})
export type FabricConfig = z.infer<typeof FabricConfigSchema>

/** A Partition is a metal-stack failure domain (one site / room). Spines,
 *  exits, superspines, mgmt spines and mgmt servers live in its central
 *  rack; workers and storage live in the compute racks. */
export const PartitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  fabric: FabricConfigSchema,
  racks: z.array(RackSchema),
  rackDefaults: RackDefaultsSchema.default({ heightUnits: 42, maxPowerWatts: 10000 }),
})
export type Partition = z.infer<typeof PartitionSchema>

/** External attachment points (internet uplink, company networks, storage
 *  backends). They attach at the exit switches of a partition. */
export const ExternalNetworkSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['internet', 'company', 'storage', 'other']),
  attachedPartitionId: z.string().default(''),
})
export type ExternalNetwork = z.infer<typeof ExternalNetworkSchema>

export const PlanSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  partitions: z.array(PartitionSchema),
  externalNetworks: z.array(ExternalNetworkSchema),
  /** Fixed number of spares added per transceiver and cable BOM line. */
  sparesPerLine: z.number().int().min(0).default(2),
  /** IPv4/IPv6 address plan (IPs tab). */
  ipPlan: IpPlanSchema.default(defaultIpPlan),
})
export type Plan = z.infer<typeof PlanSchema>
