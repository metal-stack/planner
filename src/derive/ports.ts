import { breakoutChildren, frontPanelIndex, sonicPortNames, type PortSpeed } from '../model/catalog'
import { mgmtDeviceCount, type Plan } from '../model/plan'
import { mgmtUplinkSpeed, rackBmcPorts } from './bom'
import { devicesOf, type Device, type PartitionDevices } from './devices'

// Every switch's front-panel ports, derived from the cabling model of
// derive/bom.ts and the SONiC port maps in the catalog: which ports are
// broken out, which carry the BGP underlay, and the speed and MTU of each
// used port. Uplinks take a switch's last ports of their speed, everything
// else its first ports, in plan order. Both NOS paths of the Ansible export
// render this one plan.
//
// - leaves: per leaf, 2 × nodes / leaves server ports: 25G ones on the
//   first 100G ports in 4x25G breakout (four per port), 100G ones natively
//   after them, both at MTU 9000 with RS-FEC (as Enterprise SONiC
//   deployments set them); leafSpineLinks to every spine on the last ports.
// - exits: two links per internet router first, one to every spine last
// - storage leaves: one link to every spine on the last ports
// - spines: leaves (rack order, leafSpineLinks each), storage leaves and
//   exits from the first port, superspines on the last ports
// - superspines: one link per spine from the first port
// - mgmt leaves: the rack's BMCs and leaf mgmt interfaces on the first
//   copper ports, one uplink to every mgmt spine on the last ports of the
//   uplink speed (mgmtUplinkSpeed(); SFP28 ports also run 10G)
// - mgmt spines: every mgmt server, then their share of the central
//   switches' and routers' mgmt interfaces on the first copper ports, the
//   mgmt leaves on the first fiber ports
//
// Production ports run MTU 9216, management ports 9000 (as metal-stack
// deployments do). BGP runs on the fabric links, and in an L3 management
// network on the mgmt uplinks and mgmt server ports. Where the catalog has
// no SONiC map or the ports don't suffice, the plan carries a reason and
// the export writes placeholders.

export const PROD_MTU = 9216
export const MGMT_MTU = 9000
export const SERVER_MTU = 9000
export const BREAKOUT_MODE = '4x25G'

export interface PortSetting {
  name: string
  /** Mbit/s, as SONiC's config_db writes it (100000 = 100G). */
  speed: number
  mtu: number
  /** Forward error correction, where it is set explicitly. */
  fec?: 'rs'
  /** What the port connects to, for comments ("servers" on leaves). */
  use: string
}

export interface Breakout {
  port: string
  /** Front-panel number, Enterprise SONiC's breakout name is "1/<n>". */
  frontPanel: number
  mode: string
}

export interface SwitchPorts {
  /** Ports running BGP (sonic_config_bgp_ports); null with a reason. */
  bgp: string[] | null
  /** Leaves: the spine uplinks (metal_core_spine_uplinks). */
  uplinks?: string[] | null
  breakouts: Breakout[]
  /** Port settings of the used ports. */
  ports: PortSetting[]
  /** Why the plan could not be made. */
  reason?: string
}

interface Need {
  speed: PortSpeed
  count: number
  end: 'first' | 'last'
  use: string
  bgp?: boolean
  /** List the ports as port settings (default true). */
  list?: boolean
  breakout?: boolean
  /** Speed the ports run at when it differs from the group's. */
  runAt?: number
  mtu?: number
  fec?: 'rs'
  uplink?: boolean
}

const SPEED_MBPS: Record<PortSpeed, number> = {
  '1G': 1000,
  '10G': 10000,
  '25G': 25000,
  '100G': 100000,
}

function groupNames(modelId: string, speed: PortSpeed): string[] | null {
  return sonicPortNames(modelId, speed) ?? (speed === '10G' ? sonicPortNames(modelId, '25G') : null)
}

/** Lays the needs out on the device's ports: `first` needs from the first
 *  port upwards, `last` needs from the last port downwards, per speed. */
function layout(d: Device, mtu: number, needs: Need[]): SwitchPorts {
  const out: SwitchPorts = { bgp: [], uplinks: [], breakouts: [], ports: [] }
  const fail = (reason: string): SwitchPorts => ({
    bgp: null,
    uplinks: null,
    breakouts: [],
    ports: [],
    reason,
  })
  const taken = new Map<PortSpeed, { first: number; last: number; total: number }>()
  const firsts: string[] = []
  const lasts: string[] = []
  for (const need of needs.filter((n) => n.count > 0)) {
    const names = groupNames(d.modelId, need.speed)
    if (!names) return fail(`no SONiC port map for ${d.modelId}`)
    const t = taken.get(need.speed) ?? { first: 0, last: 0, total: names.length }
    taken.set(need.speed, t)
    if (t.first + t.last + need.count > t.total) {
      const wanted = needs.filter((n) => n.speed === need.speed).reduce((s, n) => s + n.count, 0)
      return fail(`needs ${wanted} ${need.speed} ports, has ${t.total}`)
    }
    const ports =
      need.end === 'first'
        ? names.slice(t.first, t.first + need.count)
        : names.slice(t.total - t.last - need.count, t.total - t.last)
    if (need.end === 'first') t.first += need.count
    else t.last += need.count
    if (need.breakout) {
      for (const port of ports) {
        out.breakouts.push({
          port,
          frontPanel: frontPanelIndex(d.modelId, port)!,
          mode: BREAKOUT_MODE,
        })
      }
    }
    if (need.list !== false) {
      const speed = need.runAt ?? SPEED_MBPS[need.speed]
      // A broken-out port is set per lane.
      const names = need.breakout ? ports.flatMap((p) => breakoutChildren(p, BREAKOUT_MODE)) : ports
      for (const name of names) {
        out.ports.push({
          name,
          speed,
          mtu: need.mtu ?? mtu,
          ...(need.fec ? { fec: need.fec } : {}),
          use: need.use,
        })
      }
    }
    if (need.bgp) (need.end === 'first' ? firsts : lasts).push(...ports)
    if (need.uplink) out.uplinks!.push(...ports)
  }
  out.bgp = [...firsts, ...lasts]
  // Port settings in port order, as a switch lists them.
  const order = (name: string) => Number(/(\d+)$/.exec(name)?.[1] ?? 0)
  out.ports.sort((a, b) => order(a.name) - order(b.name))
  return out
}

export function derivePorts(plan: Plan, devices: PartitionDevices[]): Map<string, SwitchPorts> {
  const out = new Map<string, SwitchPorts>()
  devices.forEach((p, i) => {
    const partition = plan.partitions[i]
    const { fabric } = partition
    const count = (role: Device['role']) => devicesOf(p, role).length
    const spines = count('spine')
    const superspines = count('superspine')
    const links = fabric.leafSpineLinks
    const fabricUp = (n: number, use: string): Need => ({
      speed: '100G',
      count: n,
      end: 'last',
      use,
      bgp: true,
      uplink: true,
    })

    for (const d of p.devices) {
      switch (d.role) {
        case 'leaf': {
          const rack = partition.racks.find((r) => r.id === d.rack?.rackId)!
          const perLeaf = (uplink: '2x25G' | '2x100G') =>
            Math.ceil(
              (2 *
                rack.servers.filter((g) => g.uplink === uplink).reduce((n, g) => n + g.count, 0)) /
                Math.max(rack.leafCount, 1),
            )
          out.set(
            d.hostname,
            layout(d, PROD_MTU, [
              {
                speed: '100G',
                count: Math.ceil(perLeaf('2x25G') / 4),
                end: 'first',
                use: 'servers',
                breakout: true,
                runAt: 25000,
                mtu: SERVER_MTU,
                fec: 'rs',
              },
              {
                speed: '100G',
                count: perLeaf('2x100G'),
                end: 'first',
                use: 'servers',
                mtu: SERVER_MTU,
                fec: 'rs',
              },
              fabricUp(spines * links, 'spines'),
            ]),
          )
          break
        }
        case 'exit':
          out.set(
            d.hostname,
            layout(d, PROD_MTU, [
              { speed: '100G', count: 2 * count('router'), end: 'first', use: 'internet routers' },
              fabricUp(spines, 'spines'),
            ]),
          )
          break
        case 'storage-leaf':
          out.set(d.hostname, layout(d, PROD_MTU, [fabricUp(spines, 'spines')]))
          break
        case 'spine':
          out.set(
            d.hostname,
            layout(d, PROD_MTU, [
              {
                speed: '100G',
                count: count('leaf') * links,
                end: 'first',
                use: 'leaves',
                bgp: true,
              },
              {
                speed: '100G',
                count: count('storage-leaf'),
                end: 'first',
                use: 'storage leaves',
                bgp: true,
              },
              { speed: '100G', count: count('exit'), end: 'first', use: 'exits', bgp: true },
              { ...fabricUp(superspines, 'superspines'), uplink: false },
            ]),
          )
          break
        case 'superspine':
          out.set(
            d.hostname,
            layout(d, PROD_MTU, [
              { speed: '100G', count: spines, end: 'first', use: 'spines', bgp: true },
            ]),
          )
          break
      }
    }

    const { mgmt } = fabric
    const l3 = mgmt.layer === 'l3'
    const uplinkSpeed = mgmtUplinkSpeed(mgmt.leafModelId, mgmt.spineModelId)
    // SFP28 ports run 10G when the other end has no 25G.
    const fiber = (count: number, end: 'first' | 'last', use: string, uplink = false): Need => ({
      speed: uplinkSpeed,
      count,
      end,
      use,
      bgp: l3,
      uplink,
      runAt: SPEED_MBPS[uplinkSpeed],
    })
    const mgmtSpines = mgmtDeviceCount(mgmt)
    for (const d of devicesOf(p, 'mgmt-leaf')) {
      const rack = partition.racks.find((r) => r.id === d.rack?.rackId)!
      const copper = Math.ceil(
        (rackBmcPorts(rack) + rack.leafCount) / Math.max(mgmt.leafPerRack, 1),
      )
      out.set(
        d.hostname,
        layout(d, MGMT_MTU, [
          { speed: '1G', count: copper, end: 'first', use: 'BMCs and leaf mgmt interfaces' },
          fiber(mgmtSpines, 'last', 'mgmt spines', true),
        ]),
      )
    }
    // As the BOM: one mgmt interface per central switch and router.
    const centralMgmt =
      count('spine') + count('exit') + count('superspine') + count('storage-leaf') + count('router')
    devicesOf(p, 'mgmt-spine').forEach((d, s) => {
      // Central mgmt interfaces are spread over the mgmt spines.
      const share = Math.floor(centralMgmt / mgmtSpines) + (s < centralMgmt % mgmtSpines ? 1 : 0)
      out.set(
        d.hostname,
        layout(d, MGMT_MTU, [
          { speed: '1G', count: count('mgmt-server'), end: 'first', use: 'mgmt servers', bgp: l3 },
          { speed: '1G', count: share, end: 'first', use: 'central mgmt interfaces' },
          fiber(count('mgmt-leaf'), 'first', 'mgmt leaves'),
        ]),
      )
    })
  })
  return out
}
