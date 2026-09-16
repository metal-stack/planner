// Static hardware catalog. Hardware facts (part numbers, port counts, U
// heights, nodes per chassis, compatibility) live here as data — derivation
// code in src/derive/ must never hard-code them.
//
// Compatibility (`status`, `switchRoles`, `serverUsages`) follows the official
// metal-stack list:
// https://docs.metal-stack.io/ -> Operators -> Hardware Support
// (docs repo: docs/src/operators/hardware.md). Management servers, routers
// and mgmt/OOB gear are not provisioned by metal-stack itself, so the list
// does not apply to them; they carry roles but no support status.
//
// That list is authoritative for *compatibility only*, not for spelling: it
// mixes prefixed and unprefixed Supermicro models in one table
// (`SYS-2029BT-HNR` beside `5039MD8-H8TNR`) and spells the vendor
// `Edge-Core`, `EdgeCore` and `Edgecore` on the same page. Here, identity is
// split into three fields instead:
//
//   vendor      the manufacturer, in the vendor's own spelling
//   model       the designation people say out loud ('AS7726-32X')
//   partNumber  the orderable ordering code, when a stable one exists
//
// `model` and `partNumber` coincide for Supermicro (SYS-220BT-HNTR) but
// diverge for Intel (E810-CQDA2 vs the ordering code E810CQDA2). For the
// Edgecore switches the full orderable code additionally encodes airflow,
// PSU and region (e.g. 7726-32X-O-AC-F-US for the AS7726-32X / DCS204) —
// choices this planner does not model, so `partNumber` stays the model and
// the configuration is left to the order. Commodity items (copper patch
// leads, LC duplex patch cables) have no stable public SKU and carry none;
// inventing one would be worse than an empty cell.
//
// Description grammar — checked by catalog.test.ts:
//   - spec only: never the vendor, model, part number, U height or node
//     count, all of which are fields above
//   - ports as `<n>× <speed> <form factor>`, comma-separated, in the order
//     of the `ports` array, with PortSpeed spellings (1G/10G/25G/100G)
//   - `×` and `→`, never `x` or `->`
//   - drives as `<n>× <size> <kind>`, e.g. `20× 2.5" NVMe`
//   - parentheses for caveats and cross-references only, never for specs
//   - no trailing period
//
// Part number provenance. Verified against the real orders in sample-boms/
// (untracked): the Supermicro SYS-/SSG- codes, ET7402-SR4, ET5402-SR,
// ET4201-RJ45, ET5402-RJ45, SFP28-25G-SR, all four NOS support licenses
// (S-ECSONIC-* and S-SONIC-EB-*) and the two BlueOptics cable codes. Verified against the vendor's own site:
// AS-3015MR-H8TNR, SYS-2029UZ-TN20R25M, the Intel ordering codes, and the
// two NVIDIA codes (no sample BOM orders GPUs).
//
// Beware search engines here: neither BlueOptics cable code is indexed, and
// Edgecore's site lists ET4202-RJ45 where the orders show ET4201-RJ45. The
// sample BOMs outrank both — they are what was actually bought.

import type { Nos } from './plan'

export type CatalogCategory =
  'switch' | 'server' | 'router' | 'nic' | 'gpu' | 'transceiver' | 'cable' | 'license'

export type SupportStatus = 'stable' | 'alpha'

/** Vendor lifecycle, independent of metal-stack's `status`: a model can be
 *  perfectly supported by metal-stack and no longer orderable. */
export type Availability = 'current' | 'eol' | 'withdrawn'

export type SwitchRole =
  'leaf' | 'spine' | 'superspine' | 'exit' | 'storage-leaf' | 'mgmt-spine' | 'mgmt-leaf'

export type ServerUsage = 'worker' | 'management' | 'storage'

export type PortSpeed = '1G' | '10G' | '25G' | '100G'

/** Platform tier a NOS support license is priced by. The vendors name the
 *  tiers differently — Edgecore sells "40/100G" and "10/25G", Broadcom
 *  "100G" and "10G" — so the license table maps this per NOS. */
export type LicenseClass = '100g' | '25g'

export interface CatalogItem {
  id: string
  category: CatalogCategory
  /** Manufacturer, in the vendor's own spelling: 'Edgecore', 'Supermicro'. */
  vendor?: string
  /** Vendor model designation: 'AS7726-32X', 'SYS-220BT-HNTR'. */
  model?: string
  /** Orderable ordering code, where a stable public one exists. */
  partNumber?: string
  /** Spec only — see the description grammar in the header. */
  description: string
  heightUnits?: number
  /** For multi-node chassis (MicroCloud, BigTwin): server nodes per chassis. */
  nodesPerChassis?: number
  /** Typical power draw per chassis / device in watts, for rack power
   *  estimates. MicroCloud and BigTwin figures come from the sample BOMs
   *  (1600 W / 2200 W per full chassis); the rest are datasheet-based
   *  estimates. Partial chassis are scaled by their node count. */
  powerWatts?: number
  ports?: { speed: PortSpeed; count: number }[]
  /** metal-stack support status; absent = not applicable (mgmt gear, cables…). */
  status?: SupportStatus
  /** Vendor lifecycle; absent = current. */
  availability?: Availability
  /** Fabric roles a switch may take. */
  switchRoles?: SwitchRole[]
  /** Platform tier a switch is licensed as. The license itself depends on
   *  the partition's chosen NOS — see `nosLicenseId`. */
  licenseClass?: LicenseClass
  /** Usages a server model fits. */
  serverUsages?: ServerUsage[]
  /** Max GPUs a single server node of this model accepts; absent = none. */
  gpuCapable?: number
  /** No plan can select this item, so it never reaches a BOM: it is kept
   *  because the official compatibility list names it. Say why. Every
   *  otherwise-unreachable entry must set this (catalog.test.ts), so that
   *  dead entries are a declared choice rather than an oversight. */
  referenceOnly?: string
}

export const catalog: Record<string, CatalogItem> = {
  // --- Switches (official metal-stack compatibility list, SONiC) ---
  // Edgecore's current product names are DCS204 (AS7726-32X), DCS501
  // (AS7712-32X) and EPS201 (AS4630-54TE); the model designations below are
  // what the metal-stack list and the sample BOMs use.
  'switch-as7726': {
    id: 'switch-as7726',
    category: 'switch',
    vendor: 'Edgecore',
    model: 'AS7726-32X',
    partNumber: 'AS7726-32X',
    description: '32× 100G QSFP28',
    heightUnits: 1,
    powerWatts: 300,
    ports: [{ speed: '100G', count: 32 }],
    status: 'stable',
    switchRoles: ['leaf', 'spine', 'superspine', 'exit', 'storage-leaf'],
    licenseClass: '100g',
  },
  'switch-as7712': {
    id: 'switch-as7712',
    category: 'switch',
    vendor: 'Edgecore',
    model: 'AS7712-32X',
    partNumber: 'AS7712-32X',
    description: '32× 100G QSFP28',
    heightUnits: 1,
    powerWatts: 250,
    ports: [{ speed: '100G', count: 32 }],
    status: 'stable',
    // Edgecore lists AS7712-32X-EC on its end-of-life page.
    availability: 'eol',
    switchRoles: ['leaf', 'spine', 'superspine', 'exit', 'storage-leaf'],
    licenseClass: '100g',
  },
  'switch-as4630': {
    id: 'switch-as4630',
    category: 'switch',
    vendor: 'Edgecore',
    model: 'AS4630-54TE',
    partNumber: 'AS4630-54TE',
    description: '48× 1G RJ45, 4× 25G SFP28, 2× 100G QSFP28',
    heightUnits: 1,
    powerWatts: 90,
    ports: [
      { speed: '1G', count: 48 },
      { speed: '25G', count: 4 },
      { speed: '100G', count: 2 },
    ],
    status: 'stable',
    switchRoles: ['mgmt-spine', 'mgmt-leaf'],
    licenseClass: '25g',
  },
  'switch-as4625': {
    id: 'switch-as4625',
    category: 'switch',
    vendor: 'Edgecore',
    model: 'AS4625-54T',
    partNumber: 'AS4625-54T',
    description: '48× 1G RJ45, 6× 10G SFP+',
    heightUnits: 1,
    powerWatts: 70,
    ports: [
      { speed: '1G', count: 48 },
      { speed: '10G', count: 6 },
    ],
    status: 'stable',
    switchRoles: ['mgmt-spine', 'mgmt-leaf'],
    licenseClass: '25g',
  },

  // --- Servers (official metal-stack compatibility list) ---
  'server-microcloud-x11': {
    id: 'server-microcloud-x11',
    category: 'server',
    vendor: 'Supermicro',
    model: 'SYS-5039MD8-H8TNR',
    // sample BOM: "8 Worker-Server: SUPERMICRO SYS-5039MD8-H8TNR".
    partNumber: 'SYS-5039MD8-H8TNR',
    description: 'MicroCloud SuperServer, X11SDD-8C-F board',
    heightUnits: 3,
    powerWatts: 1600,
    nodesPerChassis: 8,
    status: 'stable',
    availability: 'eol',
    serverUsages: ['worker'],
  },
  'server-microcloud-x13': {
    id: 'server-microcloud-x13',
    category: 'server',
    vendor: 'Supermicro',
    model: 'SYS-531MC-H8TNR',
    partNumber: 'SYS-531MC-H8TNR',
    description: 'MicroCloud SuperServer, X13SCD-F board, single-width GPU per node',
    heightUnits: 3,
    powerWatts: 2000,
    nodesPerChassis: 8,
    status: 'stable',
    serverUsages: ['worker'],
    gpuCapable: 1,
  },
  'server-microcloud-h13': {
    id: 'server-microcloud-h13',
    category: 'server',
    vendor: 'Supermicro',
    model: 'AS-3015MR-H8TNR',
    partNumber: 'AS-3015MR-H8TNR',
    description: 'MicroCloud A+ Server, H13SRD-F board, AMD EPYC, single-width GPU per node',
    heightUnits: 3,
    powerWatts: 2000,
    nodesPerChassis: 8,
    status: 'stable',
    serverUsages: ['worker'],
    gpuCapable: 1,
  },
  'server-bigtwin-x11': {
    id: 'server-bigtwin-x11',
    category: 'server',
    vendor: 'Supermicro',
    model: 'SYS-2029BT-HNR',
    partNumber: 'SYS-2029BT-HNR',
    description: 'BigTwin SuperServer, X11DPT-B board',
    heightUnits: 2,
    powerWatts: 2200,
    nodesPerChassis: 4,
    status: 'stable',
    serverUsages: ['worker'],
    availability: 'eol',
  },
  'server-bigtwin-x12': {
    id: 'server-bigtwin-x12',
    category: 'server',
    vendor: 'Supermicro',
    model: 'SYS-220BT-HNTR',
    partNumber: 'SYS-220BT-HNTR',
    description: 'BigTwin SuperServer, X12DPT-B6 board, 6× 2.5" NVMe per node',
    heightUnits: 2,
    powerWatts: 2600,
    nodesPerChassis: 4,
    status: 'stable',
    serverUsages: ['worker'],
  },
  'server-superserver-tn20': {
    id: 'server-superserver-tn20',
    category: 'server',
    vendor: 'Supermicro',
    model: 'SYS-2029UZ-TN20R25M',
    partNumber: 'SYS-2029UZ-TN20R25M',
    description: 'Ultra SuperServer, X11DPU board, 20× 2.5" NVMe',
    heightUnits: 2,
    powerWatts: 700,
    nodesPerChassis: 1,
    status: 'stable',
    serverUsages: ['worker', 'storage'],
    availability: 'eol',
  },
  'server-superserver-tn12': {
    id: 'server-superserver-tn12',
    category: 'server',
    vendor: 'Supermicro',
    model: 'SYS-621C-TN12R',
    partNumber: 'SYS-621C-TN12R',
    description: 'SuperServer, X13DDW-A board, 12× 2.5" NVMe',
    heightUnits: 2,
    powerWatts: 800,
    nodesPerChassis: 1,
    status: 'stable',
    serverUsages: ['worker', 'storage'],
  },
  'server-superserver-tr12p': {
    id: 'server-superserver-tr12p',
    category: 'server',
    vendor: 'Supermicro',
    model: 'SSG-5019D8-TR12P',
    partNumber: 'SSG-5019D8-TR12P',
    description: 'SuperStorage, X11SDV-8C-TP8F board, 12× 3.5" SATA',
    heightUnits: 1,
    powerWatts: 500,
    nodesPerChassis: 1,
    status: 'stable',
    serverUsages: ['worker', 'storage'],
    availability: 'eol',
  },
  'server-lenovo-sd530': {
    id: 'server-lenovo-sd530',
    category: 'server',
    vendor: 'Lenovo',
    model: 'SD530',
    // Machine type of the compute node. A complete order also needs the D2
    // enclosure (MT 7X20) that holds four of these — the catalog cannot
    // express chassis-plus-node yet, so this line counts nodes only.
    partNumber: '7X21',
    description: 'ThinkSystem compute node for the D2 enclosure',
    heightUnits: 2,
    powerWatts: 2000,
    nodesPerChassis: 4,
    status: 'alpha',
    availability: 'withdrawn',
    serverUsages: ['worker'],
  },
  // Management servers are not provisioned by metal-stack, so the
  // compatibility list does not apply and any current 1U dual-socket server
  // will do. The X11-generation 6019U is kept for plans that already name
  // it; new plans get the X13 Hyper (see defaults.ts).
  'server-mgmt': {
    id: 'server-mgmt',
    category: 'server',
    vendor: 'Supermicro',
    model: 'SYS-6019U-TN4R4T',
    partNumber: 'SYS-6019U-TN4R4T',
    description: 'Ultra SuperServer, 4× 3.5" bays (not provisioned by metal-stack)',
    heightUnits: 1,
    powerWatts: 400,
    nodesPerChassis: 1,
    availability: 'eol',
    serverUsages: ['management'],
  },
  'server-mgmt-121h': {
    id: 'server-mgmt-121h',
    category: 'server',
    vendor: 'Supermicro',
    model: 'SYS-121H-TNR',
    partNumber: 'SYS-121H-TNR',
    description: 'Hyper SuperServer, X13DEM board, 8× 2.5" NVMe (not provisioned by metal-stack)',
    heightUnits: 1,
    powerWatts: 500,
    nodesPerChassis: 1,
    serverUsages: ['management'],
  },

  // --- Routers ---
  'router-internet': {
    id: 'router-internet',
    category: 'router',
    // Deliberately vendor-neutral: any 1U server with two dual-port 100G
    // NICs does the job, and the sample BOMs specify it this way.
    description: 'Internet router, 2× dual-port 100G QSFP28 (Intel E810-CQDA2)',
    heightUnits: 1,
    ports: [{ speed: '100G', count: 4 }],
    powerWatts: 400,
  },

  // --- NICs (official metal-stack compatibility list) ---
  // Intel's ordering codes drop the hyphen of the marketing model name.
  'nic-e810-xxvda2': {
    id: 'nic-e810-xxvda2',
    category: 'nic',
    vendor: 'Intel',
    model: 'E810-XXVDA2',
    partNumber: 'E810XXVDA2',
    description: 'Dual-port 2× 25G SFP28',
    status: 'stable',
  },
  'nic-e810-cqda2': {
    id: 'nic-e810-cqda2',
    category: 'nic',
    vendor: 'Intel',
    model: 'E810-CQDA2',
    // MM# 978322 (retail unit); OEM tray is E810CQDA2G2P5.
    partNumber: 'E810CQDA2',
    description: 'Dual-port 2× 100G QSFP28',
    status: 'stable',
  },
  'nic-xxv710-da2': {
    id: 'nic-xxv710-da2',
    category: 'nic',
    vendor: 'Intel',
    model: 'XXV710-DA2',
    partNumber: 'XXV710DA2',
    description: 'Dual-port 2× 25G SFP28',
    status: 'stable',
    referenceOnly: 'NIC choice follows ServerGroup.uplink, so only the E810 pair is used',
  },
  'nic-connectx5': {
    id: 'nic-connectx5',
    category: 'nic',
    vendor: 'Mellanox',
    model: 'MCX512A-ACAT',
    partNumber: 'MCX512A-ACAT',
    description: 'ConnectX-5, dual-port 2× 25G SFP28',
    status: 'stable',
    referenceOnly: 'NIC choice follows ServerGroup.uplink, so only the E810 pair is used',
  },

  // --- GPUs (official metal-stack compatibility list) ---
  // The list names "RTX 6000" without a generation; the Ada Generation is
  // the current product and is assumed here. No sample BOM orders GPUs, so
  // these are vendor-site figures only.
  'gpu-rtx-6000-ada': {
    id: 'gpu-rtx-6000-ada',
    category: 'gpu',
    vendor: 'NVIDIA',
    model: 'RTX 6000 Ada',
    partNumber: '900-5G133-2250-000',
    description: '48 GB GDDR6 ECC, PCIe 4.0 ×16, dual slot',
    powerWatts: 300,
    status: 'stable',
  },
  'gpu-h100-pcie': {
    id: 'gpu-h100-pcie',
    category: 'gpu',
    vendor: 'NVIDIA',
    model: 'H100 PCIe',
    partNumber: '900-21010-0000-000',
    description: '80 GB HBM2e, PCIe 5.0 ×16, dual slot',
    powerWatts: 350,
    status: 'stable',
  },

  // --- Transceivers ---
  // Edgecore original designations, as referenced by the sample BOMs (which
  // order BlueOptics equivalents against them: BO27Q856S1D for the 25G SR,
  // BO28L859S1D for the 100G SR4).
  'sfp-25g-sr': {
    id: 'sfp-25g-sr',
    category: 'transceiver',
    vendor: 'Edgecore',
    model: 'SFP28-25G-SR',
    partNumber: 'SFP28-25G-SR',
    description: '25GBASE-SR SFP28, LC duplex, 100 m on OM4',
  },
  'sfp-100g-sr4': {
    id: 'sfp-100g-sr4',
    category: 'transceiver',
    vendor: 'Edgecore',
    model: 'ET7402-SR4',
    partNumber: 'ET7402-SR4',
    description: '100GBASE-SR4 QSFP28, MPO-12, 100 m on OM4',
  },
  'sfp-10g-sr': {
    id: 'sfp-10g-sr',
    category: 'transceiver',
    vendor: 'Edgecore',
    model: 'ET5402-SR',
    partNumber: 'ET5402-SR',
    description: '10GBASE-SR SFP+, LC duplex, 300 m on OM4',
  },
  'sfp-rj45-1g': {
    id: 'sfp-rj45-1g',
    category: 'transceiver',
    vendor: 'Edgecore',
    model: 'ET4201-RJ45',
    partNumber: 'ET4201-RJ45',
    description: '1000BASE-T SFP, RJ45, 100 m on Cat5',
    referenceOnly: "the cabling model uses the switches' native RJ45 ports, not transceivers",
  },
  'sfp-rj45-10g': {
    id: 'sfp-rj45-10g',
    category: 'transceiver',
    vendor: 'Edgecore',
    model: 'ET5402-RJ45',
    partNumber: 'ET5402-RJ45',
    description: '10GBASE-T SFP+, RJ45, 30 m on Cat6A',
    referenceOnly: "the cabling model uses the switches' native RJ45 ports, not transceivers",
  },

  // --- Cables ---
  // The BlueOptics codes encode a length: SFP6262FU3MKB is the 3 m trunk,
  // SFP6262FU5MKB the 5 m one. The catalog has no length dimension yet, so
  // these pin the 5 m variant the sample BOMs order most.
  'cable-mtp-trunk': {
    id: 'cable-mtp-trunk',
    category: 'cable',
    vendor: 'BlueOptics',
    model: 'SFP6262FU5MKB',
    partNumber: 'SFP6262FU5MKB',
    description: 'MTP → MTP trunk, OM4, 5 m, 100G point-to-point',
  },
  'cable-mtp-breakout': {
    id: 'cable-mtp-breakout',
    category: 'cable',
    vendor: 'BlueOptics',
    model: 'SFP6141FU5MKB',
    partNumber: 'SFP6141FU5MKB',
    description: 'MTP → 4× LC duplex breakout, OM4, 5 m, 100G → 4× 25G',
  },
  'cable-lc-duplex': {
    id: 'cable-lc-duplex',
    category: 'cable',
    // Commodity: the sample BOMs specify it by spec and length, not SKU.
    description: 'LC duplex patch, OM4 50/125 µm, 10G / 25G point-to-point',
  },
  'cable-rj45': {
    id: 'cable-rj45',
    category: 'cable',
    // Commodity: no stable public SKU. The previous 'RJ45-1G' was invented.
    description: 'Cat6 patch, RJ45, 1G (OOB and management)',
  },

  // --- Licenses ---
  // One NOS support license per switch, picked by the partition's `nos` and
  // the switch's `licenseClass` (see nosLicenseId). Both sets are priced
  // side by side in the sample BOMs, which evaluated the two distributions
  // on the same hardware ("1x Leaf EdgeCore SONiC, 1x Leaf Broadcom SONiC").
  //
  // Edgecore's own distribution is closed to new customers: existing support
  // contracts run out with no renewal. Broadcom's is current, and Edgecore
  // sells and qualifies its switches for it.
  'lic-sonic-eb-100g': {
    id: 'lic-sonic-eb-100g',
    category: 'license',
    vendor: 'Broadcom',
    // The sample BOM writes this one without the trailing "Y" that the
    // other three carry; reproduced as ordered.
    model: 'S-SONIC-EB-100G-3',
    partNumber: 'S-SONIC-EB-100G-3',
    description: 'Enterprise SONiC support and maintenance, 3 years, 100G platform',
  },
  'lic-sonic-eb-10g': {
    id: 'lic-sonic-eb-10g',
    category: 'license',
    vendor: 'Broadcom',
    model: 'S-SONIC-EB-10G-3Y',
    partNumber: 'S-SONIC-EB-10G-3Y',
    description: 'Enterprise SONiC support and maintenance, 3 years, 10G platform',
  },
  // Ids kept as they were so existing price books stay keyed correctly.
  'lic-sonic-100g': {
    id: 'lic-sonic-100g',
    category: 'license',
    vendor: 'Edgecore',
    model: 'S-ECSONIC-40-100G-3Y',
    partNumber: 'S-ECSONIC-40-100G-3Y',
    description: 'Enterprise SONiC support and maintenance, 3 years, 40G/100G platform',
    availability: 'eol',
  },
  'lic-sonic-25g': {
    id: 'lic-sonic-25g',
    category: 'license',
    vendor: 'Edgecore',
    model: 'S-ECSONIC-10-25G-3Y',
    partNumber: 'S-ECSONIC-10-25G-3Y',
    description: 'Enterprise SONiC support and maintenance, 3 years, 10G/25G platform',
    availability: 'eol',
  },
}

/** The NOS choices a partition can make.
 *
 *  Neither option is free of caveats, and the planner shows both sides at
 *  the point of choice rather than after the fact: Edgecore's distribution
 *  is the one the official metal-stack hardware list verifies, but it is
 *  end-of-life at the vendor; Broadcom's is current and qualified by
 *  Edgecore on this hardware, but does not appear in that list. */
export interface NosOption {
  id: Nos
  vendor: string
  name: string
  /** Whether the official metal-stack hardware list names this NOS. */
  verified: boolean
  /** Support license per platform tier. */
  licenses: Record<LicenseClass, string>
}

export const nosOptions: NosOption[] = [
  {
    id: 'broadcom-sonic',
    vendor: 'Broadcom',
    name: 'Enterprise SONiC',
    verified: false,
    licenses: { '100g': 'lic-sonic-eb-100g', '25g': 'lic-sonic-eb-10g' },
  },
  {
    id: 'edgecore-sonic',
    vendor: 'Edgecore',
    name: 'Enterprise SONiC',
    verified: true,
    licenses: { '100g': 'lic-sonic-100g', '25g': 'lic-sonic-25g' },
  },
]

export function nosOption(nos: Nos): NosOption {
  return nosOptions.find((o) => o.id === nos) ?? nosOptions[0]
}

/** Support license a switch needs under a given NOS, or undefined when the
 *  model carries no license class (routers, servers). */
export function nosLicenseId(nos: Nos, modelId: string): string | undefined {
  const licenseClass = catalog[modelId]?.licenseClass
  return licenseClass && nosOption(nos).licenses[licenseClass]
}

/** "Broadcom Enterprise SONiC" — how the NOS is named in the UI and BOM. */
export function nosLabel(nos: Nos): string {
  const option = nosOption(nos)
  return `${option.vendor} ${option.name}`
}

/** Ids renamed or removed in newer catalog versions -> current replacement. */
export const legacyIdMap: Record<string, string> = {
  'server-microcloud': 'server-microcloud-x11',
  'server-bigtwin': 'server-bigtwin-x11',
  'server-lightbits': 'server-superserver-tn20',
  'switch-as5835': 'switch-as7726',
}

export function currentCatalogId(id: string): string {
  return legacyIdMap[id] ?? id
}

export function catalogItem(id: string): CatalogItem {
  const item = catalog[id]
  if (!item) throw new Error(`Unknown catalog id: ${id}`)
  return item
}

export function portCount(item: CatalogItem, speed: PortSpeed): number {
  return item.ports?.find((p) => p.speed === speed)?.count ?? 0
}

// Dropdown order: current hardware first, then eol, then withdrawn.
// Catalog order within each group (the sort is stable).
const availabilityRank: Record<Availability, number> = { current: 0, eol: 1, withdrawn: 2 }

function rankOf(item: CatalogItem): number {
  return availabilityRank[item.availability ?? 'current']
}

function byAvailability(a: CatalogItem, b: CatalogItem): number {
  return rankOf(a) - rankOf(b)
}

export function switchesForRole(role: SwitchRole): CatalogItem[] {
  return Object.values(catalog)
    .filter((i) => i.switchRoles?.includes(role))
    .sort(byAvailability)
}

export function serversForUsage(usage: ServerUsage): CatalogItem[] {
  return Object.values(catalog)
    .filter((i) => i.serverUsages?.includes(usage))
    .sort(byAvailability)
}

/** GPU models offerable for a server model — empty unless it accepts any. */
export function gpusForServer(serverModelId: string): CatalogItem[] {
  if (!catalog[serverModelId]?.gpuCapable) return []
  return Object.values(catalog)
    .filter((i) => i.category === 'gpu')
    .sort(byAvailability)
}

/** How a BOM line names its item: the model people say, else the ordering
 *  code, else the raw id. */
export function itemLabel(id: string): string {
  const item = catalog[id]
  return item?.model ?? item?.partNumber ?? id
}
