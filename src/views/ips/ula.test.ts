import { describe, expect, it } from 'vitest'
import { ipPresets } from '../../model/ipPlan'
import { parseCidr } from '../../derive/ip/cidr'
import { kubernetesRangesInUla, randomUla48 } from './ula'

describe('ULA helpers', () => {
  it('reproduces the preset layout for the preset /48', () => {
    const r = parseCidr('fd8e:7a15:7ac6::/48')
    if (!r.ok) throw new Error(r.error)
    const v6 = ipPresets[0].ipv6
    expect(kubernetesRangesInUla(r.cidr.addr)).toEqual({
      shootPodCidr: v6.shootPodCidr,
      seedPodCidr: v6.seedPodCidr,
      shootServiceCidr: v6.shootServiceCidr,
      seedServiceCidr: v6.seedServiceCidr,
    })
  })

  it('generates an fd00::/8 /48', () => {
    const ula = randomUla48()
    expect(ula >> 120n).toBe(0xfdn)
    expect(ula & ((1n << 80n) - 1n)).toBe(0n)
  })
})
