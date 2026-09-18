import {
  ArrowRight,
  Binary,
  Boxes,
  Building,
  Cable,
  Calculator,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircuitBoard,
  Cpu,
  Cloud,
  Container,
  Database,
  Dices,
  Download,
  EthernetPort,
  ExternalLink,
  FileCode,
  FileText,
  Folder,
  Copy,
  Globe,
  HardDrive,
  Info,
  KeyRound,
  Layers,
  LayoutTemplate,
  ListChecks,
  Network,
  Package,
  PencilRuler,
  Plus,
  Redo2,
  RefreshCw,
  RotateCcw,
  Router,
  Ruler,
  Scan,
  Server,
  ServerCog,
  SlidersHorizontal,
  Trash,
  TriangleAlert,
  Gauge,
  Undo2,
  Upload,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { SlotKind } from '../../derive/rackLayout'
import type { TopoNodeKind } from '../../derive/topology'
import type { CatalogCategory } from '../../model/catalog'
import type { ExternalNetwork } from '../../model/plan'
import type { View } from '../../store/planStore'
import { NetworkSwitch, Rack, RackGroup } from './custom'

// The single place icons come from (Lucide plus the custom switch and rack
// glyphs). Views import from here, never from lucide-react directly — an
// ESLint rule enforces it — so the whole set can be restyled or swapped in
// one file. Typed records make a new node kind or BOM category without an
// icon a type error.

export type { LucideIcon }
export { NetworkSwitch, Rack, RackGroup }

export const TAB_ICON: Record<View, LucideIcon> = {
  plan: PencilRuler,
  topology: Network,
  racks: Rack,
  ips: Binary,
  bom: ListChecks,
  ansible: FileCode,
}

export const ACTION_ICON = {
  undo: Undo2,
  redo: Redo2,
  download: Download,
  upload: Upload,
  templates: LayoutTemplate,
  presets: SlidersHorizontal,
  menu: ChevronDown,
  reset: RotateCcw,
  add: Plus,
  remove: Trash,
  close: X,
  open: ArrowRight,
  info: Info,
  external: ExternalLink,
  random: Dices,
  fit: Scan,
  fill: RefreshCw,
  copy: Copy,
} satisfies Record<string, LucideIcon>

export const SECTION_ICON = {
  partition: Layers,
  centralRack: Rack,
  mgmtNetwork: Cable,
  rack: Rack,
  rackGroup: RackGroup,
  externalNetworks: Globe,
  internet: Globe,
  projectNetworks: Layers,
  kubernetes: Container,
  limits: Calculator,
  example: Boxes,
  infrastructure: Cable,
  bom: ListChecks,
  deployment: SlidersHorizontal,
  files: FileCode,
  placeholders: PencilRuler,
} satisfies Record<string, LucideIcon>

export const FILE_ICON = {
  folder: Folder,
  file: FileText,
} satisfies Record<string, LucideIcon>

export const SEVERITY_ICON = {
  error: CircleAlert,
  warning: TriangleAlert,
  ok: CircleCheck,
} satisfies Record<string, LucideIcon>

export const NODE_ICON: Record<TopoNodeKind, LucideIcon> = {
  router: Router,
  superspine: NetworkSwitch,
  spine: NetworkSwitch,
  exit: NetworkSwitch,
  leaf: NetworkSwitch,
  'storage-leaf': NetworkSwitch,
  'mgmt-spine': NetworkSwitch,
  'mgmt-leaf': NetworkSwitch,
  'mgmt-server': ServerCog,
  'server-group': Server,
  'external-network': Globe,
}

export const EXTERNAL_NETWORK_ICON: Record<ExternalNetwork['kind'], LucideIcon> = {
  internet: Globe,
  company: Building,
  storage: Database,
  other: Cloud,
}

export const CATEGORY_ICON: Record<CatalogCategory | 'spare', LucideIcon> = {
  switch: NetworkSwitch,
  server: Server,
  router: Router,
  nic: CircuitBoard,
  gpu: Cpu,
  transceiver: EthernetPort,
  cable: Cable,
  license: KeyRound,
  spare: Package,
}

export const SLOT_ICON: Record<SlotKind, LucideIcon> = {
  network: NetworkSwitch,
  mgmt: ServerCog,
  server: Server,
  storage: HardDrive,
}

export const STAT_ICON = {
  nodes: Server,
  partitions: Layers,
  racks: Rack,
  rackUnits: Ruler,
  switches: NetworkSwitch,
  chassis: Boxes,
  power: Zap,
  bandwidth: Gauge,
  cost: Wallet,
} satisfies Record<string, LucideIcon>

/** A decorative icon at text size (16 px by default). */
export function Icon({
  icon: Glyph,
  className = 'h-4 w-4',
}: {
  icon: LucideIcon
  className?: string
}) {
  return <Glyph aria-hidden="true" focusable="false" className={`shrink-0 ${className}`} />
}
