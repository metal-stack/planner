import { createEmptyPlan, defaultRack } from '../model/defaults'
import type { Plan } from '../model/plan'

/** A leaf-spine-superspine plan for tests: two pods of one rack each
 *  (2 leaves, 8 workers on 2x25G), 2 spines per pod, 4 superspines (2 per
 *  plane), 2 exits, 2 routers. */
export function podPlan(): Plan {
  const plan = createEmptyPlan()
  const p = plan.partitions[0]
  p.fabric.fabricType = 'leaf-spine-superspine'
  p.fabric.spineCount = 2
  p.fabric.superspineCount = 4
  p.fabric.routerCount = 2
  p.pods = [
    { id: 'pa', name: 'Pod A' },
    { id: 'pb', name: 'Pod B' },
  ]
  p.racks[0].podId = 'pa'
  p.racks.push({ ...defaultRack('Rack 2'), podId: 'pb' })
  return plan
}
