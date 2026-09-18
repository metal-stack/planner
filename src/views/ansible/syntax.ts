import { CHANGE_ME } from '../../derive/ansible'

// Tokenizers for the file previews of the Ansible tab: YAML and INI lines
// into colored tokens, markdown into blocks. They cover what the export
// writes (block-style YAML, the README's headings, tables, lists and code
// fences), not the full languages. Views render tokens as React elements,
// never as HTML strings, so plan names can't inject markup.

export type TokenKind =
  | 'plain'
  | 'key'
  | 'punct'
  | 'string'
  | 'number'
  | 'literal'
  | 'template'
  | 'comment'
  | 'placeholder'

export interface Token {
  kind: TokenKind
  text: string
}

/** Splits Jinja expressions and CHANGE_ME out of a scalar. */
function scalarTokens(text: string, kind: TokenKind): Token[] {
  return text
    .split(new RegExp(`(\\{\\{.*?\\}\\}|${CHANGE_ME})`))
    .filter((part) => part !== '')
    .map((part) => ({
      kind: part === CHANGE_ME ? 'placeholder' : /^\{\{.*\}\}$/.test(part) ? 'template' : kind,
      text: part,
    }))
}

/** Index of a ` #` comment outside quotes, or -1. */
function commentStart(text: string): number {
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) return i
  }
  return -1
}

function valueTokens(value: string): Token[] {
  const hash = commentStart(value)
  const body = hash < 0 ? value : value.slice(0, hash)
  const trimmed = body.trimEnd()
  const tail = body.slice(trimmed.length)
  const out: Token[] = []
  if (/^(["']).*\1$/.test(trimmed)) out.push(...scalarTokens(trimmed, 'string'))
  else if (/^-?\d+(\.\d+)?$/.test(trimmed)) out.push({ kind: 'number', text: trimmed })
  else if (/^(true|false|null|~)$/i.test(trimmed)) out.push({ kind: 'literal', text: trimmed })
  else if (/^(\[\]|\{\}|[|>][-+]?)$/.test(trimmed)) out.push({ kind: 'punct', text: trimmed })
  else out.push(...scalarTokens(trimmed, 'plain'))
  if (tail) out.push({ kind: 'plain', text: tail })
  if (hash >= 0) out.push({ kind: 'comment', text: value.slice(hash) })
  return out
}

// A key: quoted, or plain up to the first colon followed by a space or the
// end of the line (so "partition-1:1-mgmt-server:" is one key).
const KEY = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^\s#'"](?:[^:]|:(?!\s|$))*?)(:)(?=\s|$)/

export function yamlTokens(text: string): Token[][] {
  let blockIndent: number | null = null
  return text
    .replace(/\n$/, '')
    .split('\n')
    .map((line): Token[] => {
      const indent = line.length - line.trimStart().length
      if (blockIndent !== null) {
        // Block scalars are scripts here; a CHANGE_ME in them is text.
        if (line.trim() === '' || indent > blockIndent) return [{ kind: 'plain', text: line }]
        blockIndent = null
      }
      if (/^\s*#/.test(line) || line === '---') {
        return [{ kind: line === '---' ? 'punct' : 'comment', text: line }]
      }
      const out: Token[] = []
      const lead = /^(\s*)(- )?/.exec(line)!
      if (lead[1]) out.push({ kind: 'plain', text: lead[1] })
      if (lead[2]) out.push({ kind: 'punct', text: lead[2] })
      let rest = line.slice(lead[0].length)
      const key = KEY.exec(rest)
      if (key) {
        out.push(...scalarTokens(key[1], 'key'), { kind: 'punct', text: ':' })
        rest = rest.slice(key[0].length)
        const space = /^\s*/.exec(rest)![0]
        if (space) out.push({ kind: 'plain', text: space })
        rest = rest.slice(space.length)
      }
      if (rest) {
        const value = valueTokens(rest)
        if (value[0]?.kind === 'punct' && /^[|>]/.test(value[0].text)) blockIndent = indent
        out.push(...value)
      }
      return out
    })
}

/** ansible.cfg: comments, [sections], key = value. */
export function iniTokens(text: string): Token[][] {
  return text
    .replace(/\n$/, '')
    .split('\n')
    .map((line): Token[] => {
      if (/^\s*[#;]/.test(line)) return [{ kind: 'comment', text: line }]
      if (/^\s*\[.*\]\s*$/.test(line)) return [{ kind: 'literal', text: line }]
      const m = /^(\s*[^=]+?)(\s*=\s*)(.*)$/.exec(line)
      if (!m) return [{ kind: 'plain', text: line }]
      return [
        { kind: 'key', text: m[1] },
        { kind: 'punct', text: m[2] },
        { kind: 'string', text: m[3] },
      ]
    })
}

// --- Markdown ----------------------------------------------------------

export type MdBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'code'; lang: string; text: string }

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())

export function markdownBlocks(text: string): MdBlock[] {
  const lines = text.split('\n')
  const blocks: MdBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = /^```(\w*)\s*$/.exec(line)
    if (fence) {
      const body: string[] = []
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) body.push(lines[i])
      blocks.push({ kind: 'code', lang: fence[1], text: body.join('\n') })
      i++
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] })
      i++
      continue
    }
    if (/^\s*\|/.test(line) && /^\s*\|\s*:?-/.test(lines[i + 1] ?? '')) {
      const header = cells(line)
      const rows: string[][] = []
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) rows.push(cells(lines[i]))
      blocks.push({ kind: 'table', header, rows })
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      for (; i < lines.length && /^\s*[-*]\s+/.test(lines[i]); i++) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
      }
      blocks.push({ kind: 'list', items })
      continue
    }
    if (line.trim() === '') {
      i++
      continue
    }
    const para: string[] = []
    for (
      ;
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6}\s|```|\s*\||\s*[-*]\s)/.test(lines[i]);
      i++
    ) {
      para.push(lines[i].trim())
    }
    // A line no block takes (a lone "| x", "```sh extra") is text.
    if (para.length === 0) para.push(lines[i++].trim())
    blocks.push({ kind: 'paragraph', text: para.join(' ') })
  }
  return blocks
}

export type Inline = { kind: 'text' | 'code' | 'strong'; text: string }

/** `code` and **strong** spans of a markdown line. */
export function inlineSpans(text: string): Inline[] {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/)
    .filter((part) => part !== '')
    .map((part) =>
      part.startsWith('`')
        ? { kind: 'code', text: part.slice(1, -1) }
        : part.startsWith('**')
          ? { kind: 'strong', text: part.slice(2, -2) }
          : { kind: 'text', text: part },
    )
}
