// A small YAML writer for plain data (maps, lists, strings, numbers,
// booleans). Every string is written as a JSON string, which is a valid
// YAML double-quoted scalar, so nothing is reinterpreted on the way in:
// "no", "on" and "1.10" stay strings, "{{ lo }}" stays a Jinja expression.
// Undefined values are left out; there is no placeholder for them.

export type YamlValue = string | number | boolean | undefined | YamlValue[] | YamlMap
export interface YamlMap {
  [key: string]: YamlValue
}

const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/

function key(k: string): string {
  return PLAIN_KEY.test(k) ? k : JSON.stringify(k)
}

function scalar(v: string | number | boolean): string {
  return typeof v === 'string' ? JSON.stringify(v) : String(v)
}

function isEmpty(v: YamlValue): boolean {
  return Array.isArray(v) ? v.length === 0 : typeof v === 'object' && Object.keys(v).length === 0
}

function block(v: YamlValue, indent: string): string {
  if (Array.isArray(v)) {
    return v
      .filter((item) => item !== undefined)
      .map((item) => {
        if (item !== null && typeof item === 'object' && !isEmpty(item)) {
          const inner = block(item, indent + '  ')
          return `${indent}- ${inner.slice(indent.length + 2)}`
        }
        return `${indent}- ${inline(item)}\n`
      })
      .join('')
  }
  return Object.entries(v as YamlMap)
    .filter(([, x]) => x !== undefined)
    .map(([k, x]) =>
      x !== null && typeof x === 'object' && !isEmpty(x)
        ? `${indent}${key(k)}:\n${block(x, indent + '  ')}`
        : `${indent}${key(k)}: ${inline(x)}\n`,
    )
    .join('')
}

function inline(v: YamlValue): string {
  if (Array.isArray(v)) return '[]'
  if (typeof v === 'object') return '{}'
  return scalar(v as string | number | boolean)
}

export function toYaml(doc: YamlMap): string {
  return block(doc, '')
}
