// Format version of exported plan files and of the localStorage copy.
//
// Every file carries `schemaVersion`. On import the file is brought up to
// SCHEMA_VERSION by the migrations below and then validated against the
// schema, so plans written by older versions of the planner keep loading.
// A file from a newer version is refused with a readable message rather
// than a schema error.
//
// The current format is version 1 and needs no migration. Fields added
// with a Zod `.default()` stay compatible on their own; only a change that
// breaks older files bumps SCHEMA_VERSION and adds a function to
// MIGRATIONS, keyed by the version it upgrades *from*:
//
//   export const SCHEMA_VERSION = 2
//   const MIGRATIONS = { 1: (raw) => ({ ...raw, /* reshape here */ }) }

export const SCHEMA_VERSION = 1

type RawPlan = Record<string, unknown>

const MIGRATIONS: Record<number, (raw: RawPlan) => RawPlan> = {}

/** Shapes from before the format version was enforced: `zones` became
 *  `partitions`, `attachedZoneId` became `attachedPartitionId`, and server
 *  groups with the removed `management` role are dropped (management
 *  servers live on the fabric's management network). Fields that merely
 *  disappeared are stripped by the schema. */
function cleanLegacyShapes(raw: RawPlan): RawPlan {
  const plan = { ...raw }
  if (!plan.partitions && Array.isArray(plan.zones)) {
    plan.partitions = plan.zones
    delete plan.zones
  }
  if (Array.isArray(plan.partitions)) {
    plan.partitions = plan.partitions.map((partition) => {
      if (!partition || typeof partition !== 'object') return partition
      const p = partition as RawPlan
      if (!Array.isArray(p.racks)) return partition
      return {
        ...p,
        racks: p.racks.map((rack) => {
          if (!rack || typeof rack !== 'object') return rack
          const r = rack as RawPlan
          if (!Array.isArray(r.servers)) return rack
          return {
            ...r,
            servers: r.servers.filter(
              (g) =>
                !(g && typeof g === 'object' && (g as { role?: unknown }).role === 'management'),
            ),
          }
        }),
      }
    })
  }
  if (Array.isArray(plan.externalNetworks)) {
    plan.externalNetworks = plan.externalNetworks.map((net) => {
      if (net && typeof net === 'object' && !('attachedPartitionId' in net)) {
        const n = net as RawPlan
        if ('attachedZoneId' in n) return { ...n, attachedPartitionId: n.attachedZoneId }
      }
      return net
    })
  }
  return plan
}

export type MigrationResult =
  { ok: true; plan: RawPlan; from: number } | { ok: false; error: string }

/** Brings a raw plan object up to SCHEMA_VERSION, or explains why it
 *  cannot be read. The result still has to pass PlanSchema. */
export function migrateRawPlan(raw: unknown): MigrationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'This is not a plan file.' }
  }
  const plan = cleanLegacyShapes(raw as RawPlan)
  const version = plan.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'This is not a plan file: it has no format version.' }
  }
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        `The file uses plan format version ${version}, but this planner reads up to ` +
        `version ${SCHEMA_VERSION}. Use a newer version of the planner.`,
    }
  }
  let current = plan
  for (let v = version; v < SCHEMA_VERSION; v++) {
    const migrate = MIGRATIONS[v]
    if (!migrate) {
      return { ok: false, error: `No migration from plan format version ${v}.` }
    }
    current = migrate(current)
  }
  return { ok: true, plan: { ...current, schemaVersion: SCHEMA_VERSION }, from: version }
}
