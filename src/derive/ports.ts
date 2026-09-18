import { sonicPortNames, type PortSpeed } from '../model/catalog'
import { mgmtDeviceCount, type Plan } from '../model/plan'
import { mgmtUplinkSpeed } from './bom'
import { devicesOf, type Device, type PartitionDevices } from './devices'

// Which switch ports carry the BGP underlay, derived from the cabling
// model of derive/bom.ts and the SONiC port maps in the catalog. Uplinks
// take a switch's last ports of their speed, downlinks its first ports, in
// plan order:
//
// - leaves, exits, storage leaves: leafSpineLinks (leaves) or one link to
//   every spine on their last 100G ports
// - spines: leaves (in rack order, leafSpineLinks each), storage leaves and
//   exits from the first 100G port, superspines on the last ports
// - superspines: one link per spine from the first 100G port
// - L3 management: mgmt leaves reach every mgmt spine on their last ports
//   of the uplink speed (mgmtUplinkSpeed(); SFP28 ports also run 10G), the
//   mgmt spines take the mgmt leaves on their first such ports and the
//   mgmt servers on their first copper ports
//
// Where the catalog has no SONiC map or the ports don't suffice, the
// result is null with a reason, and the export writes a placeholder.

export interface SwitchPorts {
  /** sonic_config_bgp_ports */
  bgp: string[] | null
  /** Leaves: the spine uplinks (metal_core_spine_uplinks). */
  uplinks?: string[] | null
  /** Why bgp is null. */
  reason?: string
}

function names(modelId: string, speed: PortSpeed): string[] | null {
  return sonicPortNames(modelId, speed) ?? (speed === '10G' ? sonicPortNames(modelId, '25G') : null)
}

/** Ports for the device: `down` from the first port, `up` on the last. */
function assign(d: Device, speed: PortSpeed, down: number, up: number): SwitchPorts {
  const all = names(d.modelId, speed)
  if (!all) return { bgp: null, reason: `no SONiC port map for ${d.modelId}` }
  if (down + up > all.length) {
    return { bgp: null, reason: `needs ${down + up} ${speed} ports, has ${all.length}` }
  }
  const uplinks = up > 0 ? all.slice(all.length - up) : []
  return { bgp: [...all.slice(0, down), ...uplinks], uplinks }
}

export function derivePorts(plan: Plan, devices: PartitionDevices[]): Map<string, SwitchPorts> {
  const out = new Map<string, SwitchPorts>()
  devices.forEach((p, i) => {
    const { fabric } = plan.partitions[i]
    const count = (role: Device['role']) => devicesOf(p, role).length
    const spines = count('spine')
    const superspines = count('superspine')
    const spineDown = count('leaf') * fabric.leafSpineLinks + count('storage-leaf') + count('exit')

    for (const d of p.devices) {
      switch (d.role) {
        case 'leaf':
          out.set(d.hostname, assign(d, '100G', 0, spines * fabric.leafSpineLinks))
          break
        case 'exit':
        case 'storage-leaf':
          out.set(d.hostname, assign(d, '100G', 0, spines))
          break
        case 'spine':
          out.set(d.hostname, assign(d, '100G', spineDown, superspines))
          break
        case 'superspine':
          out.set(d.hostname, assign(d, '100G', spines, 0))
          break
      }
    }

    const { mgmt } = fabric
    if (mgmt.layer !== 'l3') return
    const speed = mgmtUplinkSpeed(mgmt.leafModelId, mgmt.spineModelId)
    const mgmtSpines = mgmtDeviceCount(mgmt)
    for (const d of devicesOf(p, 'mgmt-leaf')) {
      out.set(d.hostname, assign(d, speed, 0, mgmtSpines))
    }
    for (const d of devicesOf(p, 'mgmt-spine')) {
      const fiber = assign(d, speed, count('mgmt-leaf'), 0)
      const copper = assign(d, '1G', count('mgmt-server'), 0)
      out.set(
        d.hostname,
        fiber.bgp && copper.bgp
          ? { bgp: [...copper.bgp, ...fiber.bgp] }
          : { bgp: null, reason: fiber.reason ?? copper.reason },
      )
    }
  })
  return out
}
