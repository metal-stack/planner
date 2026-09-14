import { describe, expect, it } from 'vitest'
import {
  commonSupernet,
  contains,
  fitPrefix,
  formatCidr,
  formatCount,
  formatIp,
  overlaps,
  parseCidr,
  parseIp,
  pow2,
  size,
  subnet,
  subnetCount,
  type Cidr,
} from './cidr'

function cidr(s: string): Cidr {
  const r = parseCidr(s)
  if (!r.ok) throw new Error(r.error)
  return r.cidr
}

describe('parse and format', () => {
  it('round-trips IPv4', () => {
    expect(formatCidr(cidr('10.244.64.0/18'))).toBe('10.244.64.0/18')
    expect(parseIp('256.0.0.1')).toBeNull()
    expect(parseIp('10.0.0')).toBeNull()
  })

  it('parses and formats IPv6 per RFC 5952', () => {
    expect(formatCidr(cidr('2001:0db8:0020:0000:0000:0000:0000:0000/44'))).toBe('2001:db8:20::/44')
    expect(formatCidr(cidr('fd00::/8'))).toBe('fd00::/8')
    expect(formatCidr(cidr('::/0'))).toBe('::/0')
    const a = parseIp('1:0:0:2:0:0:0:3')!
    expect(formatIp(6, a.addr)).toBe('1:0:0:2::3')
    const b = parseIp('::ffff:10.0.0.1')!
    expect(formatIp(6, b.addr)).toBe('::ffff:a00:1')
    expect(parseIp('1::2::3')).toBeNull()
    expect(parseIp('12345::')).toBeNull()
  })

  it('reports host bits with the network as suggestion', () => {
    const r = parseCidr('10.244.1.0/16')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.suggestion).toBe('10.244.0.0/16')
  })

  it('rejects missing prefixes, overlong prefixes and the wrong family', () => {
    expect(parseCidr('10.0.0.0').ok).toBe(false)
    expect(parseCidr('10.0.0.0/33').ok).toBe(false)
    expect(parseCidr('fd00::/8', 4).ok).toBe(false)
    expect(parseCidr('').ok).toBe(false)
  })
})

describe('arithmetic', () => {
  it('counts, contains and overlaps', () => {
    expect(size(cidr('10.0.0.0/22'))).toBe(1024n)
    expect(contains(cidr('10.244.0.0/16'), cidr('10.244.64.0/18'))).toBe(true)
    expect(contains(cidr('10.244.64.0/18'), cidr('10.244.0.0/16'))).toBe(false)
    expect(overlaps(cidr('10.244.0.0/18'), cidr('10.244.64.0/18'))).toBe(false)
    expect(overlaps(cidr('10.240.0.0/12'), cidr('10.248.0.0/18'))).toBe(true)
    expect(overlaps(cidr('10.0.0.0/8'), cidr('fd00::/8'))).toBe(false)
  })

  it('subnets', () => {
    const net = cidr('10.128.0.0/9')
    expect(subnetCount(net, 12)).toBe(8n)
    expect(formatCidr(subnet(net, 12, 6n))).toBe('10.224.0.0/12')
    expect(formatCidr(subnet(cidr('2001:db8:20::/45'), 52, 1n))).toBe('2001:db8:20:1000::/52')
  })

  it('finds the common supernet and fitting prefixes', () => {
    expect(formatCidr(commonSupernet([cidr('10.240.0.0/13'), cidr('10.248.192.0/18')]))).toBe(
      '10.240.0.0/12',
    )
    expect(fitPrefix(4, 16)).toBe(28)
    expect(fitPrefix(4, 17)).toBe(27)
    expect(fitPrefix(4, 1)).toBe(32)
  })

  it('formats large counts', () => {
    expect(formatCount(1_048_576n)).toBe('1,048,576')
    expect(formatCount(pow2(64))).toBe('2⁶⁴ ≈ 1.8 × 10¹⁹')
    expect(formatCount(3n * pow2(40))).toBe('≈ 3.3 × 10¹²')
  })
})
