// Minimal IPv4/IPv6 CIDR arithmetic on BigInt, used by the IP plan. No
// dependency: parsing, RFC 5952 formatting, containment, subnetting and
// counting are all this planner needs.

export type Family = 4 | 6

export const WIDTH: Record<Family, number> = { 4: 32, 6: 128 }

export interface Cidr {
  family: Family
  /** Network address (host bits are always zero). */
  addr: bigint
  prefix: number
}

export type CidrResult =
  { ok: true; cidr: Cidr } | { ok: false; error: string; suggestion?: string }

export function pow2(n: number): bigint {
  return 1n << BigInt(n)
}

function parseV4(s: string): bigint | null {
  const parts = s.split('.')
  if (parts.length !== 4) return null
  let v = 0n
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const n = Number(p)
    if (n > 255) return null
    v = (v << 8n) | BigInt(n)
  }
  return v
}

function parseV6(s: string): bigint | null {
  const halves = s.split('::')
  if (halves.length > 2) return null
  const groups = (part: string) => (part === '' ? [] : part.split(':'))
  const toHextets = (gs: string[], mayEndWithV4: boolean): number[] | null => {
    const out: number[] = []
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i]
      if (mayEndWithV4 && i === gs.length - 1 && g.includes('.')) {
        const v4 = parseV4(g)
        if (v4 === null) return null
        out.push(Number(v4 >> 16n), Number(v4 & 0xffffn))
        continue
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
      out.push(parseInt(g, 16))
    }
    return out
  }
  const head = toHextets(groups(halves[0]), halves.length === 1)
  const tail = halves.length === 2 ? toHextets(groups(halves[1]), true) : []
  if (!head || !tail) return null
  let all: number[]
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length
    if (missing < 1) return null
    all = [...head, ...Array<number>(missing).fill(0), ...tail]
  } else {
    if (head.length !== 8) return null
    all = head
  }
  return all.reduce((v, x) => (v << 16n) | BigInt(x), 0n)
}

export function parseIp(s: string): { family: Family; addr: bigint } | null {
  const t = s.trim()
  if (t.includes(':')) {
    const addr = parseV6(t)
    return addr === null ? null : { family: 6, addr }
  }
  const addr = parseV4(t)
  return addr === null ? null : { family: 4, addr }
}

function formatV4(v: bigint): string {
  return [24n, 16n, 8n, 0n].map((s) => String((v >> s) & 0xffn)).join('.')
}

/** RFC 5952: lower case, no leading zeros, the longest run (≥ 2) of zero
 *  groups compressed to "::" (the first one on a tie). */
function formatV6(v: bigint): string {
  const h: number[] = []
  for (let i = 7; i >= 0; i--) h.push(Number((v >> BigInt(i * 16)) & 0xffffn))
  let bestStart = -1
  let bestLen = 0
  for (let i = 0; i < 8;) {
    if (h[i] !== 0) {
      i++
      continue
    }
    let j = i
    while (j < 8 && h[j] === 0) j++
    if (j - i >= 2 && j - i > bestLen) {
      bestStart = i
      bestLen = j - i
    }
    i = j
  }
  const hex = h.map((x) => x.toString(16))
  if (bestStart < 0) return hex.join(':')
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLen).join(':')}`
}

export function formatIp(family: Family, addr: bigint): string {
  return family === 4 ? formatV4(addr) : formatV6(addr)
}

export function formatCidr(c: Cidr): string {
  return `${formatIp(c.family, c.addr)}/${c.prefix}`
}

function hostMask(family: Family, prefix: number): bigint {
  return pow2(WIDTH[family] - prefix) - 1n
}

/** Parses "a.b.c.d/p" or "x:y::/p". Host bits must be zero; when they are
 *  not, the error suggests the network address. */
export function parseCidr(input: string, expected?: Family): CidrResult {
  const s = input.trim()
  if (s === '') return { ok: false, error: 'Enter a range such as 10.0.0.0/8.' }
  const slash = s.indexOf('/')
  if (slash < 0) return { ok: false, error: 'Missing the prefix length, e.g. /24.' }
  const ipText = s.slice(0, slash)
  const ip = parseIp(ipText)
  if (!ip) return { ok: false, error: `"${ipText}" is not an IPv4 or IPv6 address.` }
  if (expected && ip.family !== expected) {
    return { ok: false, error: `Expected an IPv${expected} range.` }
  }
  const prefixText = s.slice(slash + 1)
  if (!/^\d{1,3}$/.test(prefixText))
    return { ok: false, error: `"/${prefixText}" is not a prefix length.` }
  const prefix = Number(prefixText)
  const width = WIDTH[ip.family]
  if (prefix > width) return { ok: false, error: `/${prefix} is longer than ${width} bits.` }
  const mask = hostMask(ip.family, prefix)
  if ((ip.addr & mask) !== 0n) {
    const network = formatCidr({ family: ip.family, addr: ip.addr & ~mask, prefix })
    return {
      ok: false,
      error: `Host bits are set; the network is ${network}.`,
      suggestion: network,
    }
  }
  return { ok: true, cidr: { family: ip.family, addr: ip.addr, prefix } }
}

export function size(c: Cidr): bigint {
  return pow2(WIDTH[c.family] - c.prefix)
}

export function lastAddr(c: Cidr): bigint {
  return c.addr + size(c) - 1n
}

export function contains(outer: Cidr, inner: Cidr): boolean {
  if (outer.family !== inner.family || outer.prefix > inner.prefix) return false
  const shift = BigInt(WIDTH[outer.family] - outer.prefix)
  return inner.addr >> shift === outer.addr >> shift
}

export function overlaps(a: Cidr, b: Cidr): boolean {
  return contains(a, b) || contains(b, a)
}

/** Number of /prefix subnets in c (0 when prefix is shorter than c's). */
export function subnetCount(c: Cidr, prefix: number): bigint {
  return prefix < c.prefix ? 0n : pow2(prefix - c.prefix)
}

/** The index-th /prefix subnet of c. */
export function subnet(c: Cidr, prefix: number, index: bigint): Cidr {
  return { family: c.family, addr: c.addr + index * pow2(WIDTH[c.family] - prefix), prefix }
}

/** Smallest CIDR containing all given ranges (same family, non-empty). */
export function commonSupernet(cidrs: Cidr[]): Cidr {
  const family = cidrs[0].family
  const width = WIDTH[family]
  let prefix = Math.min(...cidrs.map((c) => c.prefix))
  const first = cidrs[0].addr
  while (prefix > 0) {
    const shift = BigInt(width - prefix)
    if (cidrs.every((c) => c.addr >> shift === first >> shift)) break
    prefix--
  }
  const mask = hostMask(family, prefix)
  return { family, addr: first & ~mask, prefix }
}

/** Longest prefix whose block holds `count` addresses. */
export function fitPrefix(family: Family, count: number): number {
  let bits = 0
  while (2 ** bits < count) bits++
  return WIDTH[family] - bits
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const sup = (n: number) =>
  String(n)
    .split('')
    .map((d) => SUPERSCRIPT[Number(d)])
    .join('')

/** Exact with thousands separators below 10⁹, else a power of two and/or
 *  scientific approximation ("2⁶⁴ ≈ 1.8 × 10¹⁹"). */
export function formatCount(n: bigint): string {
  if (n < 1_000_000_000n) return n.toLocaleString('en-US')
  const exp = n.toString().length - 1
  const mantissa = (Number(n / 10n ** BigInt(exp - 3)) / 1000).toFixed(1)
  const approx = `${mantissa} × 10${sup(exp)}`
  if ((n & (n - 1n)) === 0n) return `2${sup(n.toString(2).length - 1)} ≈ ${approx}`
  return `≈ ${approx}`
}
