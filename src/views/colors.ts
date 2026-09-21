// Colors for inline SVG (topology, rack elevations, address bars). SVG
// attributes can't take Tailwind classes, so these point at the theme's CSS
// variables instead: the tokens in index.css stay the single source. Keep
// each name spelled out: Tailwind only emits the variables it finds in the
// source.

export const COLOR = {
  ink: 'var(--color-ink)',
  page: 'var(--color-page)',
  white: 'var(--color-white)',
  brand: 'var(--color-brand)',
  brandSoft: 'var(--color-brand-soft)',
  brandTint: 'var(--color-brand-tint)',
  production: 'var(--color-production)',
  mgmt: 'var(--color-mgmt)',
  /** Grays, lightest first. */
  gray50: 'var(--color-gray-50)',
  gray100: 'var(--color-gray-100)',
  gray200: 'var(--color-gray-200)',
  gray300: 'var(--color-gray-300)',
  gray400: 'var(--color-gray-400)',
  gray500: 'var(--color-gray-500)',
  gray700: 'var(--color-gray-700)',
  danger: 'var(--color-red-600)',
  dangerText: 'var(--color-red-700)',
  dangerTint: 'var(--color-red-100)',
  dangerSoft: 'var(--color-red-300)',
  storageTint: 'var(--color-sky-100)',
  storageLine: 'var(--color-sky-300)',
  storageText: 'var(--color-sky-900)',
  seed: 'var(--color-violet-600)',
  seedSoft: 'var(--color-violet-300)',
  service: 'var(--color-sky-400)',
} as const
