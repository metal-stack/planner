import { formatCidr, subnet, type Cidr } from '../../derive/ip/cidr'
import type { IpFamily } from '../../model/ipPlan'

/** A random ULA /48 (RFC 4193): fd00::/8 plus a 40-bit random global ID. */
export function randomUla48(): bigint {
  const bytes = new Uint8Array(5)
  crypto.getRandomValues(bytes)
  const globalId = bytes.reduce((v, b) => (v << 8n) | BigInt(b), 0n)
  return (0xfdn << 120n) | (globalId << 80n)
}

/** The IPv6 Kubernetes ranges laid out in a ULA /48 like the presets:
 *  shoot and seed pods as the first two /54, services as /64 at :800 and :801. */
export function kubernetesRangesInUla(
  ula: bigint,
): Pick<IpFamily, 'shootPodCidr' | 'seedPodCidr' | 'shootServiceCidr' | 'seedServiceCidr'> {
  const base: Cidr = { family: 6, addr: ula, prefix: 48 }
  return {
    shootPodCidr: formatCidr(subnet(base, 54, 0n)),
    seedPodCidr: formatCidr(subnet(base, 54, 1n)),
    shootServiceCidr: formatCidr(subnet(base, 64, 0x800n)),
    seedServiceCidr: formatCidr(subnet(base, 64, 0x801n)),
  }
}
