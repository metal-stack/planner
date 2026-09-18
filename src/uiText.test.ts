import { describe, expect, it } from 'vitest'

// No long dashes (U+2014) anywhere in the UI: labels, info texts, issue
// messages, placeholders. Prose uses a colon, comma or parentheses, section
// subtitles a middle dot, empty cells an en dash. Comments may keep them.

const sources = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Source lines outside comments that contain a long dash. */
function longDashes(path: string, text: string): string[] {
  return text
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .map(({ line, n }) => ({ code: line.replace(/\s\/\/\s.*$/, ''), n }))
    .filter(({ code }) => code.includes('—'))
    .map(({ code, n }) => `${path}:${n}: ${code.trim()}`)
}

describe('UI text', () => {
  it('reads the app sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20)
  })

  it('uses no long dashes', () => {
    const hits = Object.entries(sources).flatMap(([path, text]) => longDashes(path, text))
    expect(hits).toEqual([])
  })
})
