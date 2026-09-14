import { createLucideIcon } from 'lucide-react'

// Glyphs Lucide does not have, drawn on its 24 × 24 grid with the same
// 2 px round strokes so they sit naturally next to the library icons.

/** A 1U network switch: a flat box with a row of ports. */
export const NetworkSwitch = createLucideIcon('network-switch', [
  ['rect', { x: '2', y: '7', width: '20', height: '10', rx: '2', key: 'box' }],
  ['path', { d: 'M6 12h.01', key: 'p1' }],
  ['path', { d: 'M9.5 12h.01', key: 'p2' }],
  ['path', { d: 'M13 12h.01', key: 'p3' }],
  ['path', { d: 'M16.5 12h4.5', key: 'uplink' }],
])

/** A rack: a tall frame with stacked units. */
export const Rack = createLucideIcon('rack', [
  ['rect', { x: '4', y: '2', width: '16', height: '20', rx: '2', key: 'frame' }],
  ['path', { d: 'M4 8.5h16', key: 'd1' }],
  ['path', { d: 'M4 15.5h16', key: 'd2' }],
  ['path', { d: 'M8 5.25h.01', key: 'u1' }],
  ['path', { d: 'M8 12h.01', key: 'u2' }],
  ['path', { d: 'M8 18.75h.01', key: 'u3' }],
])

/** A three-rack: three physical racks side by side. */
export const ThreeRack = createLucideIcon('three-rack', [
  ['rect', { x: '1.5', y: '4', width: '6', height: '16', rx: '1', key: 'l' }],
  ['rect', { x: '9', y: '4', width: '6', height: '16', rx: '1', key: 'm' }],
  ['rect', { x: '16.5', y: '4', width: '6', height: '16', rx: '1', key: 'r' }],
  ['path', { d: 'M9 12h6', key: 'md' }],
])
