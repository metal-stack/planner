import type { Plan, ServerGroup } from './plan'

// Server group counts represent nodes, not chassis. Moving a partial chassis
// can therefore leave either rack with a count that is not a multiple of the
// model's nodes-per-chassis value; the rack layout derives chassis again.

export interface MoveChassisArgs {
  partitionId: string
  fromRackId: string
  groupId: string
  /** Node count of the dragged chassis (a partial last chassis moves fewer). */
  nodes: number
  toRackId: string
}

function sameAttributes(a: ServerGroup, b: ServerGroup): boolean {
  return (
    a.modelId === b.modelId &&
    a.role === b.role &&
    a.uplink === b.uplink &&
    a.gpu?.modelId === b.gpu?.modelId &&
    a.gpu?.perNode === b.gpu?.perNode
  )
}

/** Moves one chassis's nodes between racks of a partition. Returns the new
 *  plan, or null when the move is a no-op so callers can skip recording
 *  history. */
export function moveChassis(plan: Plan, args: MoveChassisArgs): Plan | null {
  if (args.nodes <= 0 || args.fromRackId === args.toRackId) return null

  const partition = plan.partitions.find((candidate) => candidate.id === args.partitionId)
  const sourceRack = partition?.racks.find((rack) => rack.id === args.fromRackId)
  const targetRack = partition?.racks.find((rack) => rack.id === args.toRackId)
  const sourceGroup = sourceRack?.servers.find((group) => group.id === args.groupId)

  if (!partition || !sourceRack || !targetRack || !sourceGroup) return null
  if (args.nodes > sourceGroup.count) return null

  const matchingTarget = targetRack.servers.find((group) => sameAttributes(group, sourceGroup))
  const targetServers = matchingTarget
    ? targetRack.servers.map((group) =>
        group.id === matchingTarget.id ? { ...group, count: group.count + args.nodes } : group,
      )
    : [
        ...targetRack.servers,
        {
          id: crypto.randomUUID(),
          role: sourceGroup.role,
          modelId: sourceGroup.modelId,
          count: args.nodes,
          uplink: sourceGroup.uplink,
          ...(sourceGroup.gpu ? { gpu: { ...sourceGroup.gpu } } : {}),
        },
      ]

  return {
    ...plan,
    partitions: plan.partitions.map((candidate) =>
      candidate.id === partition.id
        ? {
            ...candidate,
            racks: candidate.racks.map((rack) => {
              if (rack.id === sourceRack.id) {
                // Remove only the moved group when it empties; other groups
                // may legitimately sit at zero nodes.
                return {
                  ...rack,
                  servers:
                    sourceGroup.count === args.nodes
                      ? rack.servers.filter((group) => group.id !== sourceGroup.id)
                      : rack.servers.map((group) =>
                          group.id === sourceGroup.id
                            ? { ...group, count: group.count - args.nodes }
                            : group,
                        ),
                }
              }
              if (rack.id === targetRack.id) return { ...rack, servers: targetServers }
              return rack
            }),
          }
        : candidate,
    ),
  }
}
