import { catalog, itemLabel, portCount, type SwitchRole } from '../model/catalog'
import {
  mgmtDeviceCount,
  type Partition,
  type Plan,
  type Rack,
  type ServerGroup,
} from '../model/plan'
import {
  formatGbps,
  formatRatio,
  rackBandwidth,
  requiredLeafSpineLinks,
  requiredSuperspines,
  spineBandwidth,
} from './bandwidth'
import { deriveBom, mgmtUplinkSpeed, nodeSwitchPorts, rackBmcPorts, spinePorts } from './bom'
import { controlPlaneLeafCount, controlPlaneSwitchPorts, inCentralRack } from './controlPlane'
import { podsOf, spinesTotal } from './pods'
import { validateIpPlan } from './ip/validateIp'
import { deriveRackLayout, formatPower } from './rackLayout'

// Validates a Plan against physical switch limits and the official
// metal-stack hardware compatibility list (encoded in catalog.ts).
// Like the BOM, issues are always derived, never stored.
//
// Capacity model assumptions (documented, kept simple on purpose):
// - Fabric links use the switches' 100G ports; one link per adjacency
//   (each leaf connects once to every spine, each spine once to every
//   superspine/exit/storage leaf).
// - 2x25G server uplinks terminate on 100G leaf ports via 4x25G breakout,
//   2x100G uplinks use one leaf port per server port.

/** What an issue is about, so the UI can badge and scroll to the right
 *  editor section. Plan-level issues have no partition; partition-level
 *  issues (fabric, mgmt network, central rack) have no rack. */
export interface IssueTarget {
  partitionId?: string
  rackId?: string
  /** Issues outside a partition: 'ips' for the IP plan tab, 'control-plane'
   *  for the plan's control plane section. */
  section?: 'ips' | 'control-plane'
  /** Field id within the section (e.g. "ipv4.shootPodCidr"). For a rack or
   *  central rack section, 'advanced' means the fix is in its folded
   *  Advanced section, which navigation then opens. */
  field?: string
}

export interface Issue {
  severity: 'error' | 'warning'
  /** Human-readable location, e.g. "Partition A / Rack 2". */
  where: string
  message: string
  target: IssueTarget
}

/** Location an issue is reported against: label plus structured target. */
interface Scope {
  where: string
  target: IssueTarget
}

function report(issues: Issue[], scope: Scope, severity: Issue['severity'], message: string) {
  issues.push({ severity, where: scope.where, message, target: scope.target })
}

/** Issues for one editor section: a rack, or a partition's fabric section
 *  (partition-level issues only, not its racks'). */
export function issuesFor(issues: Issue[], target: IssueTarget): Issue[] {
  return issues.filter(
    (i) =>
      i.target.partitionId === target.partitionId &&
      (i.target.rackId ?? null) === (target.rackId ?? null),
  )
}

export function countIssues(issues: Issue[]): {
  errors: number
  warnings: number
} {
  let errors = 0
  let warnings = 0
  for (const i of issues) {
    if (i.severity === 'error') errors++
    else warnings++
  }
  return { errors, warnings }
}

function checkSwitchRole(
  issues: Issue[],
  scope: Scope,
  modelId: string,
  role: SwitchRole,
  label: string,
): void {
  const item = catalog[modelId]
  if (!item) {
    report(issues, scope, 'error', `${label}: unknown model "${modelId}".`)
    return
  }
  if (!item.switchRoles?.includes(role)) {
    report(
      issues,
      scope,
      'error',
      `${label}: ${itemLabel(modelId)} is not on the metal-stack compatibility list for the ${role} role.`,
    )
  }
}

/** 100G leaf ports a rack's servers consume: 25G ports on 4x25G breakouts, a
 *  breakout per started four ports of one group on one leaf (nodeSwitchPorts). */
export function leafPortsNeeded(rack: Rack): number {
  return rack.servers.reduce(
    (n, group) => n + nodeSwitchPorts(group.count, group.uplink, rack.leafCount),
    0,
  )
}

/** 100G leaf ports a rack has left for servers after spine uplinks. The
 *  leaf<->mgmt connectivity uses the switches' dedicated OOB management
 *  port and therefore consumes no front-panel ports. */
export function leafPortsAvailable(rack: Rack, partition: Partition): number {
  const leaf = catalog[rack.leafModelId]
  const total = leaf ? rack.leafCount * portCount(leaf, '100G') : 0
  return total - rack.leafCount * partition.fabric.spineCount * partition.fabric.leafSpineLinks
}

function validateRack(issues: Issue[], partition: Partition, rack: Rack): void {
  const scope: Scope = {
    where: `${partition.name} / ${rack.name}`,
    target: { partitionId: partition.id, rackId: rack.id },
  }
  // Leaf model and count are edited in the rack's Advanced section.
  const inAdvanced: Scope = { ...scope, target: { ...scope.target, field: 'advanced' } }
  checkSwitchRole(issues, inAdvanced, rack.leafModelId, 'leaf', 'Leaf switch')

  const nodes = rack.servers.reduce((n, g) => n + g.count, 0)
  if (nodes > 0 && rack.leafCount === 0) {
    report(issues, inAdvanced, 'error', 'Rack has servers but no leaf switches.')
    return
  }
  if (rack.leafCount === 1) {
    report(issues, inAdvanced, 'warning', 'Only one leaf switch: no rack-level network redundancy.')
  }

  const needed = leafPortsNeeded(rack)
  const available = leafPortsAvailable(rack, partition)
  if (needed > available) {
    report(
      issues,
      scope,
      'error',
      `Leaf capacity exceeded: servers need ${needed} 100G leaf ports, ` +
        `but ${Math.max(available, 0)} are available ` +
        `(${rack.leafCount}x ${itemLabel(rack.leafModelId)}, ` +
        `minus spine uplinks). ` +
        `Reduce servers, add leaves, or switch uplink speeds.`,
    )
  }

  // Non-blocking fabric (opt-in): the machines of a rack must not have more
  // bandwidth than its leaf uplinks towards the spines.
  const bandwidth = rackBandwidth(rack, partition)
  if (partition.fabric.nonBlocking && bandwidth.ratio !== null && bandwidth.ratio > 1) {
    report(
      issues,
      scope,
      'error',
      `Fabric is oversubscribed ${formatRatio(bandwidth.ratio)}: ${formatGbps(bandwidth.downGbps)} ` +
        `of server bandwidth behind ${formatGbps(bandwidth.upGbps)} of leaf uplinks. ` +
        `A non-blocking fabric needs ${requiredLeafSpineLinks(rack, partition)} links per ` +
        `leaf ↔ spine pair (now ${partition.fabric.leafSpineLinks}), more spines, or fewer nodes in the rack.`,
    )
  }

  // Mgmt leaf port budget (1G copper): one BMC port per chassis plus one
  // management interface per leaf, against the rack's mgmt leaves.
  const mgmtLeaf = catalog[partition.fabric.mgmt.leafModelId]
  if (mgmtLeaf && nodes > 0) {
    const copperNeeded = rackBmcPorts(rack) + rack.leafCount
    const copperAvailable = partition.fabric.mgmt.leafPerRack * portCount(mgmtLeaf, '1G')
    if (copperNeeded > copperAvailable) {
      report(
        issues,
        scope,
        'error',
        `Mgmt leaf capacity exceeded: ${copperNeeded} 1G ports needed for BMC and leaf links, ` +
          `but ${partition.fabric.mgmt.leafPerRack}x ${itemLabel(partition.fabric.mgmt.leafModelId)} has ${copperAvailable}. ` +
          `Add mgmt leaves per rack or reduce chassis.`,
      )
    }
  }

  for (const group of rack.servers) {
    const item = catalog[group.modelId]
    if (!item) {
      report(issues, scope, 'error', `Unknown server model "${group.modelId}".`)
      continue
    }
    if (!item.serverUsages?.includes(group.role)) {
      report(
        issues,
        scope,
        'error',
        `${itemLabel(group.modelId)} is not on the metal-stack compatibility list for ${group.role} usage.`,
      )
    }
    if (item.status === 'alpha') {
      report(
        issues,
        scope,
        'warning',
        `${itemLabel(group.modelId)}: metal-stack support status is alpha.`,
      )
    }
    checkGpu(issues, scope, group)
  }
}

/** GPUs must exist, be GPUs, and fit the server model's per-node limit. */
function checkGpu(issues: Issue[], scope: Scope, group: ServerGroup): void {
  const { gpu } = group
  if (!gpu) return
  const server = catalog[group.modelId]
  const item = catalog[gpu.modelId]
  if (!item || item.category !== 'gpu') {
    report(issues, scope, 'error', `Unknown GPU model "${gpu.modelId}".`)
    return
  }
  const capacity = server?.gpuCapable ?? 0
  if (capacity === 0) {
    report(
      issues,
      scope,
      'error',
      `${itemLabel(group.modelId)} takes no GPUs, but ${gpu.perNode} per node are configured. ` +
        `Choose a GPU-capable server model or remove the GPUs.`,
    )
    return
  }
  if (gpu.perNode > capacity) {
    report(
      issues,
      scope,
      'error',
      `${itemLabel(group.modelId)} accepts ${capacity} GPU${capacity === 1 ? '' : 's'} per node, ` +
        `but ${gpu.perNode} are configured.`,
    )
  }
}

function validatePartition(issues: Issue[], plan: Plan, partition: Partition): void {
  const scope: Scope = {
    where: partition.name,
    target: { partitionId: partition.id },
  }
  const { fabric } = partition
  // Hardware models are picked in the central rack's Advanced section.
  const inAdvanced: Scope = { ...scope, target: { ...scope.target, field: 'advanced' } }

  checkSwitchRole(issues, inAdvanced, fabric.spineModelId, 'spine', 'Spine switch')
  checkSwitchRole(issues, scope, fabric.exitModelId, 'exit', 'Exit switch')
  checkSwitchRole(issues, inAdvanced, fabric.mgmt.spineModelId, 'mgmt-spine', 'Mgmt spine')
  checkSwitchRole(issues, inAdvanced, fabric.mgmt.leafModelId, 'mgmt-leaf', 'Mgmt leaf')
  if (fabric.storageLeafCount > 0) {
    checkSwitchRole(issues, inAdvanced, fabric.storageLeafModelId, 'storage-leaf', 'Storage leaf')
  }
  const mgmtServer = catalog[fabric.mgmt.serverModelId]
  if (!mgmtServer?.serverUsages?.includes('management')) {
    report(
      issues,
      inAdvanced,
      'error',
      `Mgmt server: ${itemLabel(fabric.mgmt.serverModelId)} is not a management server model.`,
    )
  }
  if (!fabric.mgmt.redundant) {
    report(
      issues,
      scope,
      'warning',
      'Management network is not redundant: a single mgmt spine and mgmt server.',
    )
  }

  if (fabric.fabricType === 'leaf-spine-superspine') {
    checkSwitchRole(issues, inAdvanced, fabric.superspineModelId, 'superspine', 'Superspine')
    report(
      issues,
      scope,
      'warning',
      'Leaf-spine-superspine is a planning design after RFC 7938 (pods and planes), not a ' +
        'metal-stack reference architecture: validate it in a lab before ordering.',
    )
    if (fabric.superspineCount === 0) {
      report(
        issues,
        scope,
        'error',
        'Fabric type is leaf-spine-superspine but the superspine count is 0.',
      )
    } else if (fabric.spineCount > 0 && fabric.superspineCount % fabric.spineCount !== 0) {
      const perPlane = Math.max(1, Math.round(fabric.superspineCount / fabric.spineCount))
      report(
        issues,
        inAdvanced,
        'error',
        `Superspines must split evenly into one plane per spine: ${fabric.superspineCount} ` +
          `superspines on ${fabric.spineCount} spines per pod leave ` +
          `${fabric.superspineCount % fabric.spineCount} unconnected. Use a multiple of ` +
          `${fabric.spineCount}, e.g. ${perPlane * fabric.spineCount}.`,
      )
    }
    const pods = podsOf(partition)
    for (const pod of pods) {
      if (pod.racks.length === 0) {
        report(issues, scope, 'warning', `${pod.name} has no racks; its spines carry nothing.`)
      }
    }
    if (pods.length === 1) {
      report(
        issues,
        scope,
        'warning',
        'Superspines with only one pod just join it to the central rack: leaf-spine gives the ' +
          'same with half the spines. Add pods, or use leaf-spine.',
      )
    }
    const known = new Set(partition.pods.map((p) => p.id))
    for (const rack of partition.racks) {
      if (rack.podId && !known.has(rack.podId)) {
        report(
          issues,
          { where: rack.name, target: { partitionId: partition.id, rackId: rack.id } },
          'warning',
          `${rack.name} names a pod that does not exist; it counts to ${pods[0]?.name ?? 'the first pod'}. Pick its pod in the rack section.`,
        )
      }
    }
    const superspine = catalog[fabric.superspineModelId]
    const podPorts = 1 + podsOf(partition).length
    if (superspine && podPorts > portCount(superspine, '100G')) {
      report(
        issues,
        inAdvanced,
        'error',
        `Superspine capacity exceeded: each superspine needs one 100G port per pod ` +
          `(${podPorts} with the central rack), but ${itemLabel(fabric.superspineModelId)} ` +
          `has ${portCount(superspine, '100G')}.`,
      )
    }
  } else if (fabric.superspineCount > 0) {
    report(
      issues,
      scope,
      'warning',
      'Superspine count is set but the fabric type is leaf-spine, so superspines are ignored.',
    )
  }

  if (fabric.spineCount === 1) {
    report(issues, scope, 'warning', 'Only one spine: no fabric redundancy.')
  }
  if (fabric.spineCount === 0 && partition.racks.length > 0) {
    report(issues, scope, 'error', 'Partition has racks but no spines.')
  }

  // Spine port budget, per group of spines (spinePorts in bom.ts): the
  // central rack's, and with superspines each pod's.
  const spine = catalog[fabric.spineModelId]
  if (spine && fabric.spineCount > 0) {
    const available = portCount(spine, '100G')
    for (const group of spinePorts(partition, controlPlaneLeafCount(plan, partition))) {
      if (group.perSpine > available) {
        report(
          issues,
          scope,
          'error',
          `Spine capacity exceeded (${group.name}): each spine needs ${group.perSpine} 100G ports ` +
            `(${group.detail}), but ${itemLabel(fabric.spineModelId)} has ${available}.`,
        )
      }
    }
  }

  // Non-blocking fabric at the spine tier (only with superspines).
  const spineTier = spineBandwidth(partition, controlPlaneLeafCount(plan, partition))
  if (fabric.nonBlocking && spineTier && spineTier.ratio !== null && spineTier.ratio > 1) {
    report(
      issues,
      scope,
      'error',
      `Spine tier is oversubscribed ${formatRatio(spineTier.ratio)}: ${formatGbps(spineTier.downGbps)} ` +
        `from the leaves against ${formatGbps(spineTier.upGbps)} towards the superspines. ` +
        `A non-blocking fabric needs ${requiredSuperspines(partition, controlPlaneLeafCount(plan, partition))} superspines ` +
        `(now ${fabric.superspineCount}).`,
    )
  }

  // Exit switch port budget: one 100G port per spine, two per router and,
  // when the control-plane nodes hang off the exits, their ports too (25G
  // uplinks go through 4x25G breakout, as everywhere else).
  const exit = catalog[fabric.exitModelId]
  if (exit && fabric.exitSwitchCount > 0) {
    const cpPorts = inCentralRack(plan, partition) ? controlPlaneSwitchPorts(plan.controlPlane) : 0
    const needed = fabric.spineCount + 2 * fabric.routerCount + cpPorts
    const available = portCount(exit, '100G')
    if (needed > available) {
      const cpWhy = cpPorts > 0 ? `, ${cpPorts} for the control plane nodes` : ''
      report(
        issues,
        cpPorts > 0 ? { where: 'Control plane', target: { section: 'control-plane' } } : scope,
        'error',
        `Exit switch capacity exceeded: each exit needs ${needed} 100G ports ` +
          `(${fabric.spineCount} spines, 2 × ${fabric.routerCount} routers${cpWhy}), ` +
          `but ${itemLabel(fabric.exitModelId)} has ${available}.`,
      )
    }
  }

  // Mgmt spine port budgets, matching the cable plan (derive/deploy/
  // cabling.ts): the management interfaces of the central rack's switches,
  // routers and on-prem control plane nodes are spread over the mgmt spines
  // in turn, so each takes its share plus its own mgmt server on 1G copper
  // (the mgmt firewall lands on the spine's own mgmt port, not a front-panel
  // one); fiber ports (25G, or 10G on switches without 25G) take the uplink
  // of every mgmt leaf.
  const mgmtSpine = catalog[fabric.mgmt.spineModelId]
  if (mgmtSpine && partition.racks.length > 0) {
    const superspines = fabric.fabricType === 'leaf-spine-superspine' ? fabric.superspineCount : 0
    const devices =
      spinesTotal(partition) +
      fabric.exitSwitchCount +
      superspines +
      fabric.storageLeafCount +
      fabric.routerCount +
      (inCentralRack(plan, partition) ? plan.controlPlane.nodeCount : 0)
    const mgmtSpines = mgmtDeviceCount(fabric.mgmt)
    const copperNeeded = Math.ceil(devices / mgmtSpines) + 1
    const copperAvailable = portCount(mgmtSpine, '1G')
    if (copperNeeded > copperAvailable) {
      report(
        issues,
        scope,
        'error',
        `Mgmt spine capacity exceeded: ${copperNeeded} 1G ports needed per mgmt spine ` +
          `(${devices} management interfaces over ${mgmtSpines}, plus its mgmt server), ` +
          `but ${itemLabel(fabric.mgmt.spineModelId)} has ${copperAvailable}.`,
      )
    }

    const speed = mgmtUplinkSpeed(fabric.mgmt.leafModelId, fabric.mgmt.spineModelId)
    const fiberNeeded = fabric.mgmt.leafPerRack * partition.racks.length
    const fiberAvailable = portCount(mgmtSpine, speed)
    if (fiberNeeded > fiberAvailable) {
      report(
        issues,
        inAdvanced,
        'warning',
        `Mgmt spine fiber ports: ${fiberNeeded} mgmt leaf uplinks need ${fiberNeeded} ${speed} ports ` +
          `per mgmt spine, but ${itemLabel(fabric.mgmt.spineModelId)} has ${fiberAvailable}. ` +
          `Plan a breakout of its 100G ports or fewer racks per partition.`,
      )
    }
  }

  for (const rack of partition.racks) validateRack(issues, partition, rack)
}

/** Vendor lifecycle, once per distinct item the plan would order. The BOM
 *  is the complete list of what a plan needs — switches, servers, GPUs,
 *  cables and NOS licenses — so it is the right thing to walk here. */
const AVAILABILITY_NOTE: Record<'eol' | 'withdrawn', string> = {
  eol: 'is end-of-life at the vendor',
  withdrawn: 'has been withdrawn by the vendor',
}

function checkAvailability(issues: Issue[], plan: Plan): void {
  const seen = new Set<string>()
  for (const line of deriveBom(plan)) {
    const id = line.catalogId.split('#')[0]
    const availability = catalog[id]?.availability
    if (!availability || availability === 'current' || seen.has(id)) continue
    seen.add(id)
    report(
      issues,
      { where: 'Plan', target: {} },
      'warning',
      `${itemLabel(id)} ${AVAILABILITY_NOTE[availability]}, so it may no longer be orderable.`,
    )
  }
}

/** The control plane's own checks. Where it runs is free (the deployment
 *  guide is explicit that a managed cluster is fine), so only the on-prem
 *  node count is checked here; the ports those nodes take are part of the
 *  exit switch budget in validatePartition. */
function validateControlPlane(issues: Issue[], plan: Plan): void {
  const cp = plan.controlPlane
  if (cp.hosting !== 'on-prem') return
  const scope = { where: 'Control plane', target: { section: 'control-plane' as const } }
  if (cp.nodeCount === 0) {
    report(
      issues,
      scope,
      'error',
      'The control plane runs on-prem but has no nodes: it needs a Kubernetes cluster to run on.',
    )
    return
  }
  if (cp.nodeCount < 3) {
    report(
      issues,
      scope,
      'warning',
      `Only ${cp.nodeCount} control plane node(s): etcd needs three for quorum, ` +
        'so the cluster cannot survive the loss of one.',
    )
  }
}

export function validatePlan(plan: Plan): Issue[] {
  const issues: Issue[] = []
  for (const partition of plan.partitions) validatePartition(issues, plan, partition)
  validateControlPlane(issues, plan)

  // Physical height: no rack may hold more units than it has.
  for (const layout of deriveRackLayout(plan)) {
    // Rack names are editable, so uniqueness is checked rather than
    // enforced; the physical rack names are what goes on the labels.
    const seen = new Set<string>()
    for (const rack of layout.racks) {
      const where = `${layout.partitionName} / ${rack.name}`
      const target = { partitionId: layout.partitionId, rackId: rack.rackId }
      // Height, power and a group's member names are edited in the rack's
      // Advanced section; the central rack's budget is partition-level.
      const inAdvanced = { where, target: { ...target, ...(rack.rackId && { field: 'advanced' }) } }
      if (seen.has(rack.name)) {
        report(
          issues,
          rack.group ? inAdvanced : { where, target },
          'warning',
          `Rack name "${rack.name}" is used more than once in ${layout.partitionName}. ` +
            `Give every physical rack its own name.`,
        )
      }
      seen.add(rack.name)
      if (rack.powerWatts > rack.maxPowerWatts) {
        report(
          issues,
          inAdvanced,
          'error',
          `Rack power budget exceeded: estimated ${formatPower(rack.powerWatts)} of ` +
            `${formatPower(rack.maxPowerWatts)} allowed. Raise the budget in the rack's ` +
            `Advanced section or move servers to another rack.`,
        )
      }
      if (rack.usedU > rack.heightUnits) {
        report(
          issues,
          inAdvanced,
          'error',
          `Rack height exceeded: ${rack.usedU}U of ${rack.heightUnits}U used.`,
        )
      }
    }
  }

  checkAvailability(issues, plan)
  issues.push(...validateIpPlan(plan))
  return issues
}
