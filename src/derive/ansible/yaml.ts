import { stringify } from 'yaml'

// A small block-style YAML writer for the Ansible export. The generated
// files carry comments (placeholders, derived facts worth knowing), which
// plain object serialization cannot express, so the generator builds an
// ordered tree of entries; scalars go through the `yaml` package so that
// quoting ("{{ jinja }}", "10.0.0.1/24", "yes") is always right.

export type YScalar = string | number | boolean
export type YValue = YScalar | null | YValue[] | YMap

export interface YEntry {
  /** Comment lines above the entry; an entry may be a comment only. */
  comment?: string
  key?: string
  value?: YValue
}

export class YMap {
  constructor(readonly entries: YEntry[]) {}
}

type EntryLike = YEntry | false | null | undefined

export const ymap = (...entries: EntryLike[]): YMap =>
  new YMap(entries.filter((e): e is YEntry => !!e))

/** `key: value`; a null value writes a bare `key:` (an inventory host). */
export const kv = (key: string, value: YValue, comment?: string): YEntry => ({
  key,
  value,
  comment,
})

export const note = (comment: string): YEntry => ({ comment })

/** An ordered map from a plain object (insertion order is kept). */
export function fromObject(o: Record<string, YValue>): YMap {
  return new YMap(Object.entries(o).map(([key, value]) => ({ key, value })))
}

function scalar(v: YScalar): string {
  if (typeof v === 'string' && v.includes('\n')) {
    throw new Error('multi-line strings are not supported')
  }
  return stringify(v, { lineWidth: 0 }).trimEnd()
}

function commentLines(comment: string | undefined, indent: string): string[] {
  if (!comment) return []
  return comment.split('\n').map((line) => (line ? `${indent}# ${line}` : `${indent}#`))
}

function writeValue(key: string, value: YValue, indent: string): string[] {
  const head = `${indent}${scalar(key)}:`
  if (value === null) return [head]
  if (Array.isArray(value)) {
    return value.length === 0 ? [`${head} []`] : [head, ...writeSeq(value, `${indent}  `)]
  }
  if (value instanceof YMap) {
    return value.entries.length === 0 ? [`${head} {}`] : [head, ...writeMap(value, `${indent}  `)]
  }
  return [`${head} ${scalar(value)}`]
}

function writeMap(map: YMap, indent: string): string[] {
  return map.entries.flatMap((e) => [
    ...commentLines(e.comment, indent),
    ...(e.key === undefined ? [] : writeValue(e.key, e.value ?? null, indent)),
  ])
}

function writeSeq(items: YValue[], indent: string): string[] {
  return items.flatMap((item) => {
    if (item instanceof YMap) {
      if (item.entries.length === 0) return [`${indent}- {}`]
      if (item.entries[0].comment || item.entries[0].key === undefined) {
        throw new Error('a sequence map must start with a key')
      }
      const lines = writeMap(item, `${indent}  `)
      return [`${indent}- ${lines[0].trimStart()}`, ...lines.slice(1)]
    }
    if (Array.isArray(item)) throw new Error('nested sequences are not supported')
    if (item === null) return [`${indent}-`]
    return [`${indent}- ${scalar(item)}`]
  })
}

/** A YAML document: `---`, optional header comment, then the map. */
export function toYaml(doc: YMap, header?: string): string {
  return ['---', ...commentLines(header, ''), ...writeMap(doc, '')].join('\n') + '\n'
}

/** A top-level sequence document (playbooks). */
export function toYamlSeq(items: YValue[], header?: string): string {
  return ['---', ...commentLines(header, ''), ...writeSeq(items, '')].join('\n') + '\n'
}
