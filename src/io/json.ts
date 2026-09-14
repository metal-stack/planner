import { migrateRawPlan, SCHEMA_VERSION } from '../model/migrate'
import { normalizePlan } from '../model/normalize'
import { PlanSchema, type Plan } from '../model/plan'

// Plan files are plain JSON of the Plan document, carrying the format
// version in `schemaVersion`. Imports are migrated up to the current
// version (model/migrate.ts) and then validated against the schema, so a
// file never enters the store unchecked.

export function exportPlanJson(plan: Plan): string {
  return JSON.stringify({ ...plan, schemaVersion: SCHEMA_VERSION }, null, 2)
}

export function importPlanJson(text: string): Plan {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('The file is not valid JSON.')
  }
  const migrated = migrateRawPlan(raw)
  if (!migrated.ok) throw new Error(migrated.error)
  const result = PlanSchema.safeParse(migrated.plan)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new Error(`The file is not a valid plan: ${issues}`)
  }
  return normalizePlan(result.data)
}
