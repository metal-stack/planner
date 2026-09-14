import { formatCidr, formatIp, lastAddr, size, type Cidr } from '../../derive/ip/cidr'

export interface BarSegment {
  cidr: Cidr
  label: string
  color: string
}

/** A horizontal map of an address range with colored sub-ranges. Tiny
 *  ranges keep a minimal visible width; hover shows label and CIDR. */
export default function RangeBar({
  domain,
  segments,
  caption,
}: {
  domain: Cidr
  segments: BarSegment[]
  caption: string
}) {
  const total = size(domain)
  const end = lastAddr(domain)
  const pos = (addr: bigint) => Number(((addr - domain.addr) * 1_000_000n) / total) / 1000
  const legend = [...new Map(segments.map((s) => [s.label.replace(/ \d+$/, ''), s.color]))]

  return (
    <figure className="space-y-1">
      <figcaption className="text-xs text-gray-600">{caption}</figcaption>
      <svg
        viewBox="0 0 1000 28"
        preserveAspectRatio="none"
        className="block h-7 w-full rounded"
        role="img"
        aria-label={caption}
      >
        <rect x={0} y={0} width={1000} height={28} fill="#f3f4f6" />
        {segments.map((s, i) => {
          const start = s.cidr.addr > domain.addr ? s.cidr.addr : domain.addr
          const stop = lastAddr(s.cidr) < end ? lastAddr(s.cidr) + 1n : end + 1n
          if (stop <= start) return null
          const x = pos(start)
          const w = Math.max(2, pos(stop) - x)
          return (
            <rect key={i} x={x} y={0} width={w} height={28} fill={s.color} stroke="#fff">
              <title>{`${s.label}: ${formatCidr(s.cidr)}`}</title>
            </rect>
          )
        })}
      </svg>
      <div className="flex justify-between font-mono text-[10px] text-gray-400">
        <span>{formatIp(domain.family, domain.addr)}</span>
        <span>{formatIp(domain.family, end)}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
        {legend.map(([label, color]) => (
          <span key={label} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
      </div>
    </figure>
  )
}
