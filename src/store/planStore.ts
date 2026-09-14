import { create, useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { persist } from 'zustand/middleware'
import { temporal } from 'zundo'
import { createEmptyPlan, defaultPartition, defaultRack } from '../model/defaults'
import { ipPresets, type IpFamily, type IpFamilyKey, type IpInfra } from '../model/ipPlan'
import { migrateRawPlan, SCHEMA_VERSION } from '../model/migrate'
import { normalizePlan } from '../model/normalize'
import {
  PlanSchema,
  type ExternalNetwork,
  type FabricConfig,
  type Plan,
  type Rack,
  type RackDefaults,
  type ServerGroup,
  type TopologyVariant,
} from '../model/plan'

export type View = 'plan' | 'topology' | 'racks' | 'ips' | 'bom'

interface PlannerState {
  plan: Plan
  activeView: View
  setActiveView: (view: View) => void
  setPlanName: (name: string) => void
  setTopology: (topology: TopologyVariant) => void
  setSparesPerLine: (sparesPerLine: number) => void
  patchIpFamily: (family: IpFamilyKey, patch: Partial<IpFamily>) => void
  patchIpInfra: (patch: Partial<IpInfra>) => void
  setIpv6Enabled: (enabled: boolean) => void
  applyIpPreset: (presetId: string) => void
  addPartition: () => void
  removePartition: (partitionId: string) => void
  renamePartition: (partitionId: string, name: string) => void
  patchFabric: (partitionId: string, patch: Partial<FabricConfig>) => void
  patchRackDefaults: (partitionId: string, patch: Partial<RackDefaults>) => void
  addRack: (partitionId: string, kind?: Rack['kind']) => void
  removeRack: (partitionId: string, rackId: string) => void
  patchRack: (partitionId: string, rackId: string, patch: Partial<Rack>) => void
  addServerGroup: (partitionId: string, rackId: string) => void
  removeServerGroup: (partitionId: string, rackId: string, groupId: string) => void
  patchServerGroup: (
    partitionId: string,
    rackId: string,
    groupId: string,
    patch: Partial<ServerGroup>,
  ) => void
  addExternalNetwork: () => void
  patchExternalNetwork: (id: string, patch: Partial<ExternalNetwork>) => void
  removeExternalNetwork: (id: string) => void
  replacePlan: (plan: Plan) => void
  resetPlan: () => void
}

function touched(plan: Plan, changes: Partial<Plan>): Plan {
  return { ...plan, ...changes, updatedAt: new Date().toISOString() }
}

function mapPartition(
  plan: Plan,
  partitionId: string,
  fn: (partition: Plan['partitions'][number]) => Plan['partitions'][number],
): Plan {
  return touched(plan, {
    partitions: plan.partitions.map((p) => (p.id === partitionId ? fn(p) : p)),
  })
}

function mapRack(plan: Plan, partitionId: string, rackId: string, fn: (rack: Rack) => Rack): Plan {
  return mapPartition(plan, partitionId, (p) => ({
    ...p,
    racks: p.racks.map((r) => (r.id === rackId ? fn(r) : r)),
  }))
}

/** Edits within this window collapse into one undo step, so typing a name
 *  or spinning a number field doesn't leave one history entry per keystroke. */
const HISTORY_GROUP_MS = 500

export const usePlanStore = create<PlannerState>()(
  persist(
    temporal(
      (set) => ({
        plan: createEmptyPlan(),
        activeView: 'plan',
        setActiveView: (activeView) => set({ activeView }),
        setPlanName: (name) => set((s) => ({ plan: touched(s.plan, { name }) })),
        setTopology: (topology) => set((s) => ({ plan: touched(s.plan, { topology }) })),
        setSparesPerLine: (sparesPerLine) =>
          set((s) => ({ plan: touched(s.plan, { sparesPerLine }) })),
        patchIpFamily: (family, patch) =>
          set((s) => ({
            plan: touched(s.plan, {
              ipPlan: {
                ...s.plan.ipPlan,
                [family]: { ...s.plan.ipPlan[family], ...patch },
              },
            }),
          })),
        patchIpInfra: (patch) =>
          set((s) => ({
            plan: touched(s.plan, {
              ipPlan: { ...s.plan.ipPlan, infra: { ...s.plan.ipPlan.infra, ...patch } },
            }),
          })),
        setIpv6Enabled: (enabled) =>
          set((s) => ({
            plan: touched(s.plan, {
              ipPlan: { ...s.plan.ipPlan, ipv6: { ...s.plan.ipPlan.ipv6, enabled } },
            }),
          })),
        applyIpPreset: (presetId) =>
          set((s) => {
            const preset = ipPresets.find((p) => p.id === presetId)
            if (!preset) return {}
            // Presets set both families; dual-stack and the infrastructure
            // inputs stay as they are.
            return {
              plan: touched(s.plan, {
                ipPlan: {
                  ...s.plan.ipPlan,
                  ipv4: structuredClone(preset.ipv4),
                  ipv6: { ...structuredClone(preset.ipv6), enabled: s.plan.ipPlan.ipv6.enabled },
                },
              }),
            }
          }),
        addPartition: () =>
          set((s) => ({
            plan: touched(s.plan, {
              partitions: [
                ...s.plan.partitions,
                defaultPartition(`Partition ${s.plan.partitions.length + 1}`),
              ],
            }),
          })),
        removePartition: (partitionId) =>
          set((s) => ({
            plan: touched(s.plan, {
              partitions: s.plan.partitions.filter((p) => p.id !== partitionId),
              // External networks pinned to the removed partition fall back
              // to "every partition".
              externalNetworks: s.plan.externalNetworks.map((n) =>
                n.attachedPartitionId === partitionId ? { ...n, attachedPartitionId: '' } : n,
              ),
            }),
          })),
        renamePartition: (partitionId, name) =>
          set((s) => ({ plan: mapPartition(s.plan, partitionId, (p) => ({ ...p, name })) })),
        patchRackDefaults: (partitionId, patch) =>
          set((s) => ({
            plan: mapPartition(s.plan, partitionId, (p) => ({
              ...p,
              rackDefaults: { ...p.rackDefaults, ...patch },
            })),
          })),
        patchFabric: (partitionId, patch) =>
          set((s) => ({
            plan: mapPartition(s.plan, partitionId, (p) => ({
              ...p,
              fabric: { ...p.fabric, ...patch },
            })),
          })),
        addRack: (partitionId, kind = 'single') =>
          set((s) => ({
            plan: mapPartition(s.plan, partitionId, (p) => ({
              ...p,
              racks: [...p.racks, defaultRack(`Rack ${p.racks.length + 1}`, kind, p.rackDefaults)],
            })),
          })),
        removeRack: (partitionId, rackId) =>
          set((s) => ({
            plan: mapPartition(s.plan, partitionId, (p) => ({
              ...p,
              racks: p.racks.filter((r) => r.id !== rackId),
            })),
          })),
        patchRack: (partitionId, rackId, patch) =>
          set((s) => ({
            plan: mapRack(s.plan, partitionId, rackId, (r) => ({ ...r, ...patch })),
          })),
        addServerGroup: (partitionId, rackId) =>
          set((s) => ({
            plan: mapRack(s.plan, partitionId, rackId, (r) => ({
              ...r,
              servers: [
                ...r.servers,
                {
                  id: crypto.randomUUID(),
                  role: 'worker',
                  modelId: 'server-microcloud-x11',
                  count: 8,
                  uplink: '2x25G',
                },
              ],
            })),
          })),
        removeServerGroup: (partitionId, rackId, groupId) =>
          set((s) => ({
            plan: mapRack(s.plan, partitionId, rackId, (r) => ({
              ...r,
              servers: r.servers.filter((g) => g.id !== groupId),
            })),
          })),
        patchServerGroup: (partitionId, rackId, groupId, patch) =>
          set((s) => ({
            plan: mapRack(s.plan, partitionId, rackId, (r) => ({
              ...r,
              servers: r.servers.map((g) => (g.id === groupId ? { ...g, ...patch } : g)),
            })),
          })),
        addExternalNetwork: () =>
          set((s) => ({
            plan: touched(s.plan, {
              externalNetworks: [
                ...s.plan.externalNetworks,
                {
                  id: crypto.randomUUID(),
                  name: `Network ${s.plan.externalNetworks.length + 1}`,
                  kind: 'company',
                  attachedPartitionId: '',
                },
              ],
            }),
          })),
        patchExternalNetwork: (id, patch) =>
          set((s) => ({
            plan: touched(s.plan, {
              externalNetworks: s.plan.externalNetworks.map((n) =>
                n.id === id ? { ...n, ...patch } : n,
              ),
            }),
          })),
        removeExternalNetwork: (id) =>
          set((s) => ({
            plan: touched(s.plan, {
              externalNetworks: s.plan.externalNetworks.filter((n) => n.id !== id),
            }),
          })),
        replacePlan: (plan) => set({ plan }),
        resetPlan: () => set({ plan: createEmptyPlan() }),
      }),
      {
        // Only the plan is undoable; the active tab is UI state.
        partialize: (s) => ({ plan: s.plan }),
        equality: (a, b) => a.plan === b.plan,
        limit: 200,
        handleSet: (handleSet) => {
          // zundo's type for the wrapped setter is zustand's 2-arg setState,
          // but it actually forwards all four history arguments.
          const record = handleSet as unknown as (...args: unknown[]) => void
          let lastAt = 0
          return (...args) => {
            const now = Date.now()
            const grouped = now - lastAt < HISTORY_GROUP_MS
            lastAt = now
            if (!grouped) record(...args)
          }
        },
      },
    ),
    {
      name: 'metal-stack-planner/plan',
      version: SCHEMA_VERSION,
      migrate: (persisted) => persisted as { plan: Plan; activeView: View },
      partialize: (s) => ({ plan: s.plan, activeView: s.activeView }),
      // Runs on every rehydrate (unlike migrate, which is version-gated):
      // migrate the stored plan to the current format, re-parse it through
      // the schema so plans stored by older app versions pick up new fields
      // via Zod defaults, and map legacy catalog ids — falling back to a
      // fresh plan if the stored one no longer parses.
      merge: (persisted, current) => {
        const s = persisted as { plan?: unknown; activeView?: View } | undefined
        const migrated = migrateRawPlan(s?.plan)
        const parsed = migrated.ok ? PlanSchema.safeParse(migrated.plan) : null
        return {
          ...current,
          plan: parsed?.success ? normalizePlan(parsed.data) : createEmptyPlan(),
          activeView: s?.activeView ?? current.activeView,
        }
      },
    },
  ),
)

/** Undo/redo state for the plan history (zundo temporal store). */
export function useHistory() {
  return useStore(
    usePlanStore.temporal,
    useShallow((t) => ({
      canUndo: t.pastStates.length > 0,
      canRedo: t.futureStates.length > 0,
      undo: t.undo,
      redo: t.redo,
    })),
  )
}

// Rehydration from localStorage happens synchronously during store creation
// above; make sure it never counts as an undoable edit.
usePlanStore.temporal.getState().clear()
