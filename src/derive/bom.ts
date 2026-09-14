import { catalog, itemLabel, nosLabel, nosLicenseId, portCount } from '../model/catalog'
import {
  mgmtDeviceCount,
  type Nos,
  type Partition,
  type Plan,
  type Rack,
  type ServerGroup,
} from '../model/plan'

// The BOM is always derived from the Plan, never stored. Every quantity rule
// lives here and gets a unit test in bom.test.ts. Every rule also records a
// short reason ("14 chassis × 1 BMC port") together with where it came from
// ("Partition 2 - Rack 1"), so the BOM view can group the derivation by
// partition and rack and show how a quantity came about. Rules that apply
// per rack are emitted per rack rather than summed, so each rack's
// contribution lands in its own section.
//
// Cabling model (kept deliberately simple, mirrors the sample BOMs):
// - Production fabric: every leaf connects to every spine with
//   `leafSpineLinks` 100G links; every exit, superspine and storage leaf
//   connects once to every spine. Each link is an MTP trunk cable with a
//   100G-SR4 transceiver on both ends.
// - Server uplinks: see addServerGroup (25G breakout or 100G point-to-point).
// - Management network, copper (RJ45 1G, native ports, no transceivers):
//   one BMC/OOB port per server chassis to the rack's mgmt leaf (the sample
//   BOMs count per chassis, not per node), the single management interface
//   of every leaf to the rack's mgmt leaf, the single management interface
//   of every central-rack switch and router to the mgmt spines, and every
//   mgmt server to every mgmt spine.
// - Management network, fiber: every mgmt leaf uplinks once to every mgmt
//   spine over an LC duplex cable with an SR transceiver on both ends — 25G
//   when both switch models have 25G ports, 10G otherwise.
// - Internet routers: `routerCount` per partition in the central rack, each
//   linked twice (2x dual-port 100G NIC) to every exit switch — MTP trunk +
//   2x 100G-SR4 per link — plus one OOB copper port each.
// - Licenses: one NOS support license per switch, chosen by the partition's
//   `nos` and the switch's `licenseClass` (catalog `nosLicenseId`).
// - Spares: a fixed number (Plan.sparesPerLine) of spares per transceiver
//   and cable line, added to the plan-wide BOM only (not per partition).

/** Which of the two networks a contributing rule belongs to. A single BOM
 *  line often mixes them — 25G SR optics serve both server uplinks and the
 *  management fiber — so the scope filter has to work per rule, not per
 *  line. That is why the builder carries the network rather than the line. */
export type BomNetwork = 'production' | 'management'

/** What the BOM view shows: everything, or one of the two networks. */
export type BomScope = 'all' | BomNetwork

export interface BomLine {
  category: string
  catalogId: string
  vendor?: string
  /** Vendor model designation; what reasons and messages name the item by. */
  model?: string
  partNumber?: string
  description: string
  quantity: number
  /** One entry per contributing rule, in derivation order. */
  reasons: BomReason[]
}

/** Why some of a line's quantity is there. `where` groups the entries into
 *  sections in the BOM view ("Partition 2 - Rack 1"); it is empty for
 *  plan-wide rules such as spares. */
export interface BomReason {
  quantity: number
  /** The arithmetic, e.g. "224 × 25G ports / 4 per breakout". */
  detail: string
  where: string
}

/** One reason as a single line of text, for the CSV and XLSX exports. */
export function formatReason(reason: BomReason): string {
  const what = `${reason.quantity} (${reason.detail})`
  return reason.where ? `${reason.where}: ${what}` : what
}

/** A line's reasons as one cell of text, grouped the way the view groups
 *  them so the exports and the screen agree. */
export function formatReasons(reasons: BomReason[]): string {
  return reasons.map(formatReason).join('; ')
}

/** Reasons grouped by `where`, in first-seen order — which is the central
 *  rack, then the racks in plan order, because addPartition emits them that
 *  way. A section that reappears later merges into its earlier group, so a
 *  rule added out of order cannot break the ordering. */
export function reasonsByWhere(reasons: BomReason[]): { where: string; reasons: BomReason[] }[] {
  const groups: { where: string; reasons: BomReason[] }[] = []
  for (const reason of reasons) {
    const last = groups[groups.length - 1]
    if (last && last.where === reason.where) last.reasons.push(reason)
    else {
      const existing = groups.find((g) => g.where === reason.where)
      if (existing) existing.reasons.push(reason)
      else groups.push({ where: reason.where, reasons: [reason] })
    }
  }
  return groups
}

export const SPARE_CATEGORY = 'spare'
const SPARE_SOURCE_CATEGORIES = new Set(['transceiver', 'cable'])

/** Accumulates lines. `inPartition`, `at` and `on` return views that share
 *  the same line map through the prototype, so a rule sets its partition,
 *  location or network once instead of at every `add`. */
class BomBuilder {
  private lines = new Map<string, BomLine>()

  constructor(
    private scope: BomScope = 'all',
    private partition = '',
    private location = '',
    private network: BomNetwork = 'production',
  ) {}

  /** A view whose rules belong to a named partition. Left empty for a
   *  single-partition plan, where naming it in every reason is noise. */
  inPartition(partition: string): BomBuilder {
    const view = Object.create(this) as BomBuilder
    view.partition = partition
    return view
  }

  /** A view whose rules belong to a place within the partition, e.g. a rack
   *  name or "Central rack". */
  at(location: string): BomBuilder {
    const view = Object.create(this) as BomBuilder
    view.location = location
    return view
  }

  /** A view whose rules belong to `network`; out-of-scope adds are dropped. */
  on(network: BomNetwork): BomBuilder {
    const view = Object.create(this) as BomBuilder
    view.network = network
    return view
  }

  private where(): string {
    return [this.partition, this.location].filter(Boolean).join(' - ')
  }

  add(catalogId: string, quantity: number, detail: string): void {
    if (quantity <= 0) return
    if (this.scope !== 'all' && this.scope !== this.network) return
    const entry: BomReason = { quantity, detail, where: this.where() }
    const existing = this.lines.get(catalogId)
    if (existing) {
      existing.quantity += quantity
      existing.reasons.push(entry)
      return
    }
    // Unknown ids are skipped here; validatePlan reports them to the user.
    const item = catalog[catalogId]
    if (!item) return
    this.lines.set(catalogId, {
      category: item.category,
      catalogId,
      vendor: item.vendor,
      model: item.model,
      partNumber: item.partNumber,
      description: item.description,
      quantity,
      reasons: [entry],
    })
  }

  build(): BomLine[] {
    return [...this.lines.values()].sort(
      (a, b) => a.category.localeCompare(b.category) || a.catalogId.localeCompare(b.catalogId),
    )
  }
}

/** Server chassis needed for a group: nodes divided by nodes-per-chassis. */
export function chassisCount(group: ServerGroup): number {
  const nodesPerChassis = catalog[group.modelId]?.nodesPerChassis ?? 1
  return Math.ceil(group.count / nodesPerChassis)
}

/** BMC/OOB copper ports a rack's servers need: one per chassis. */
export function rackBmcPorts(rack: Rack): number {
  return rack.servers.reduce((n, g) => n + chassisCount(g), 0)
}

/** Fiber speed between mgmt leaf and mgmt spine: 25G if both have 25G
 *  ports, else 10G. */
export function mgmtUplinkSpeed(leafModelId: string, spineModelId: string): '25G' | '10G' {
  const leaf = catalog[leafModelId]
  const spine = catalog[spineModelId]
  const both25g = !!leaf && !!spine && portCount(leaf, '25G') > 0 && portCount(spine, '25G') > 0
  return both25g ? '25G' : '10G'
}

/** How a reason names a device: the model people say, not a region-suffixed
 *  ordering code. */
function part(modelId: string): string {
  return itemLabel(modelId)
}

/** A switch tier plus the NOS support license every switch needs. Which
 *  license that is depends on the partition's chosen NOS. */
function addSwitch(
  bom: BomBuilder,
  nos: Nos,
  modelId: string,
  count: number,
  reason: string,
): void {
  bom.add(modelId, count, reason)
  const licenseId = nosLicenseId(nos, modelId)
  if (licenseId) {
    bom.add(licenseId, count, `${count} × ${part(modelId)}, 1 ${nosLabel(nos)} license per switch`)
  }
}

function addServerGroup(bom: BomBuilder, group: ServerGroup): void {
  const nodesPer = catalog[group.modelId]?.nodesPerChassis ?? 1
  // The rack is the reason's section now, so the detail only has to say
  // which group within the rack it is.
  const role = group.role
  bom.add(
    group.modelId,
    chassisCount(group),
    `${group.count} ${role} nodes / ${nodesPer} per chassis`,
  )

  // GPUs, when fitted: one line per group, every node equipped alike.
  if (group.gpu && group.gpu.perNode > 0) {
    const gpus = group.count * group.gpu.perNode
    bom.add(group.gpu.modelId, gpus, `${group.count} ${role} nodes × ${group.gpu.perNode} GPU`)
  }

  // Every node carries one dual-port NIC matching its uplink speed.
  const uplinkPorts = 2 * group.count
  if (group.uplink === '2x25G') {
    bom.add('nic-e810-xxvda2', group.count, `${group.count} ${role} nodes × 1 NIC`)
    // 25G server ports terminate on 100G leaf ports via 4x25G breakout:
    // server side gets a 25G-SR transceiver per port, the leaf side one
    // 100G-SR4 per started group of four, joined by an MTP breakout cable.
    bom.add('sfp-25g-sr', uplinkPorts, `${group.count} ${role} nodes × 2 server ports`)
    const leafPorts = Math.ceil(uplinkPorts / 4)
    bom.add(
      'sfp-100g-sr4',
      leafPorts,
      `${uplinkPorts} × 25G ${role} ports / 4 per breakout, leaf side`,
    )
    bom.add('cable-mtp-breakout', leafPorts, `${uplinkPorts} × 25G ${role} ports / 4 per breakout`)
  } else {
    bom.add('nic-e810-cqda2', group.count, `${group.count} ${role} nodes × 1 NIC`)
    // 100G point-to-point: a 100G-SR4 transceiver on each end plus an MTP
    // trunk cable per link.
    bom.add('sfp-100g-sr4', 2 * uplinkPorts, `${uplinkPorts} × 100G ${role} links × 2 ends`)
    bom.add('cable-mtp-trunk', uplinkPorts, `${uplinkPorts} × 100G ${role} links`)
  }
}

/** Links each spine terminates: `leafSpineLinks` per leaf, one per exit,
 *  superspine and storage leaf. */
export function spinePortsPerSpine(partition: Partition): number {
  const { fabric } = partition
  const leaves = partition.racks.reduce((n, r) => n + r.leafCount, 0)
  const superspines = fabric.fabricType === 'leaf-spine-superspine' ? fabric.superspineCount : 0
  return (
    leaves * fabric.leafSpineLinks + fabric.exitSwitchCount + superspines + fabric.storageLeafCount
  )
}

/** 100G links between the internet routers and the exit switches. */
export function routerLinks(partition: Partition): number {
  return 2 * partition.fabric.routerCount * partition.fabric.exitSwitchCount
}

function addFabricLinks(bom: BomBuilder, partition: Partition): void {
  const perSpine = spinePortsPerSpine(partition)
  const links = perSpine * partition.fabric.spineCount
  const why = `${perSpine} links per spine × ${partition.fabric.spineCount} spines`
  bom.add('sfp-100g-sr4', 2 * links, `${links} fabric links × 2 ends (${why})`)
  bom.add('cable-mtp-trunk', links, `${links} fabric links (${why})`)

  const { routerCount, exitSwitchCount } = partition.fabric
  const rlinks = routerLinks(partition)
  const rwhy = `${routerCount} routers × ${exitSwitchCount} exits × 2 links`
  bom.add('sfp-100g-sr4', 2 * rlinks, `${rlinks} router links × 2 ends (${rwhy})`)
  bom.add('cable-mtp-trunk', rlinks, `${rlinks} router links (${rwhy})`)
}

/** Management cabling: the central rack first, then each rack. The per-rack
 *  rules are emitted per rack rather than summed, so each rack's
 *  contribution shows in its own section; the totals are unchanged. */
function addMgmtLinks(bom: BomBuilder, partition: Partition, central: BomBuilder): void {
  const { fabric } = partition
  const { mgmt } = fabric
  const mgmtCount = mgmtDeviceCount(mgmt)
  const superspines = fabric.fabricType === 'leaf-spine-superspine' ? fabric.superspineCount : 0
  const speed = mgmtUplinkSpeed(mgmt.leafModelId, mgmt.spineModelId)
  const uplinkOptic = speed === '25G' ? 'sfp-25g-sr' : 'sfp-10g-sr'

  // Central rack: the mgmt interface of every switch and router there, plus
  // every mgmt server to every mgmt spine.
  const centralDevices =
    fabric.spineCount +
    fabric.exitSwitchCount +
    superspines +
    fabric.storageLeafCount +
    fabric.routerCount
  central.add(
    'cable-rj45',
    centralDevices,
    `${centralDevices} switches and routers × 1 mgmt interface to the mgmt spines`,
  )
  central.add(
    'cable-rj45',
    mgmtCount * mgmtCount,
    `${mgmtCount} mgmt servers × ${mgmtCount} mgmt spines`,
  )

  // Per rack: BMC copper, the leaves' mgmt interfaces, and the mgmt leaf
  // uplinks to every mgmt spine.
  for (const rack of partition.racks) {
    const perRack = bom.at(rack.name)
    const chassis = rackBmcPorts(rack)
    perRack.add('cable-rj45', chassis, `${chassis} server chassis × 1 BMC port to the mgmt leaf`)
    perRack.add(
      'cable-rj45',
      rack.leafCount,
      `${rack.leafCount} leaves × 1 mgmt interface to the mgmt leaf`,
    )
    const links = mgmt.leafPerRack * mgmtCount
    const why = `${mgmt.leafPerRack} mgmt leaves × ${mgmtCount} mgmt spines`
    perRack.add(uplinkOptic, 2 * links, `${links} mgmt uplinks × 2 ends (${why})`)
    perRack.add('cable-lc-duplex', links, `${links} mgmt uplinks (${why})`)
  }
}

/** Section the central-rack rules are reported under. */
const CENTRAL_RACK = 'Central rack'

function addPartition(bom: BomBuilder, partition: Partition): void {
  const { fabric } = partition
  // Network and location are tagged once here, so every rule below inherits
  // the network it belongs to and the section it is reported under.
  const prodCentral = bom.on('production').at(CENTRAL_RACK)
  const mgmtCentral = bom.on('management').at(CENTRAL_RACK)

  addSwitch(
    prodCentral,
    fabric.nos,
    fabric.spineModelId,
    fabric.spineCount,
    `${fabric.spineCount} spines`,
  )
  if (fabric.fabricType === 'leaf-spine-superspine') {
    addSwitch(
      prodCentral,
      fabric.nos,
      fabric.superspineModelId,
      fabric.superspineCount,
      `${fabric.superspineCount} superspines`,
    )
  }
  addSwitch(
    prodCentral,
    fabric.nos,
    fabric.exitModelId,
    fabric.exitSwitchCount,
    `${fabric.exitSwitchCount} exit switches`,
  )
  prodCentral.add('router-internet', fabric.routerCount, `${fabric.routerCount} internet routers`)
  addSwitch(
    prodCentral,
    fabric.nos,
    fabric.storageLeafModelId,
    fabric.storageLeafCount,
    `${fabric.storageLeafCount} storage leaves`,
  )
  // Management network: spines and servers in the central rack (count
  // driven by redundancy), one mgmt leaf per compute rack.
  const mgmtCount = mgmtDeviceCount(fabric.mgmt)
  const redundancy = fabric.mgmt.redundant ? 'redundant' : 'non-redundant'
  addSwitch(
    mgmtCentral,
    fabric.nos,
    fabric.mgmt.spineModelId,
    mgmtCount,
    `${mgmtCount} mgmt spines (${redundancy})`,
  )
  mgmtCentral.add(fabric.mgmt.serverModelId, mgmtCount, `${mgmtCount} mgmt servers (${redundancy})`)

  // Everything the central rack contributes is emitted before anything a
  // compute rack does, and the racks follow in plan order. That makes the
  // reason sections come out in physical order for free: for any line, the
  // central rack is the first section, then Rack 1, Rack 2 and so on.
  addFabricLinks(prodCentral, partition)
  addMgmtLinks(bom.on('management'), partition, mgmtCentral)

  for (const rack of partition.racks) {
    addSwitch(
      bom.on('production').at(rack.name),
      fabric.nos,
      rack.leafModelId,
      rack.leafCount,
      `${rack.leafCount} leaves`,
    )
    addSwitch(
      bom.on('management').at(rack.name),
      fabric.nos,
      fabric.mgmt.leafModelId,
      fabric.mgmt.leafPerRack,
      `${fabric.mgmt.leafPerRack} mgmt leaves`,
    )
    for (const group of rack.servers) {
      addServerGroup(bom.on('production').at(rack.name), group)
    }
  }
}

function spareLines(lines: BomLine[], perLine: number): BomLine[] {
  if (perLine <= 0) return []
  return lines
    .filter((l) => SPARE_SOURCE_CATEGORIES.has(l.category))
    .map((l) => ({
      category: SPARE_CATEGORY,
      catalogId: `${l.catalogId}#spare`,
      vendor: l.vendor,
      model: l.model,
      partNumber: l.partNumber,
      // The 'spare' category already says what this is; repeating it in
      // the description only made the cell longer.
      description: l.description,
      quantity: perLine,
      reasons: [
        { quantity: perLine, detail: 'fixed spares per transceiver/cable line', where: '' },
      ],
    }))
}

/** The plan-wide BOM including spares. `scope` narrows it to one of the two
 *  networks; spares follow the scope, since they are spares for the lines
 *  actually shown. */
export function deriveBom(plan: Plan, scope: BomScope = 'all'): BomLine[] {
  const multi = plan.partitions.length > 1
  const bom = new BomBuilder(scope)
  for (const partition of plan.partitions) {
    addPartition(multi ? bom.inPartition(partition.name) : bom, partition)
  }
  const lines = bom.build()
  return [...lines, ...spareLines(lines, plan.sparesPerLine)]
}

/** One BOM per partition (without spares, which are plan-wide). */
export function deriveBomByPartition(
  plan: Plan,
  scope: BomScope = 'all',
): { partition: Partition; lines: BomLine[] }[] {
  return plan.partitions.map((partition) => {
    const bom = new BomBuilder(scope)
    addPartition(bom, partition)
    return { partition, lines: bom.build() }
  })
}
