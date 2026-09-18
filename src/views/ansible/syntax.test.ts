import { describe, expect, it } from 'vitest'
import { deriveAnsible } from '../../derive/ansible'
import { createEmptyPlan } from '../../model/defaults'
import { iniTokens, inlineSpans, markdownBlocks, yamlTokens, type Token } from './syntax'

const kinds = (line: Token[]) => line.filter((t) => t.text.trim()).map((t) => [t.kind, t.text])

describe('YAML tokens', () => {
  it('colors keys, values, comments and placeholders', () => {
    const lines = yamlTokens(
      [
        '---',
        '# header',
        'sonic_config_asn: 4200000001',
        'lo: "{{ sonic_config_loopback_address }}"',
        'flag: false # note',
        'ports:',
        '  - Ethernet120',
        'key: CHANGE_ME',
        'partition-1:1-mgmt-server:',
        '  url: oci://ghcr.io/x:{{ v }}',
      ].join('\n'),
    )
    expect(kinds(lines[0])).toEqual([['punct', '---']])
    expect(kinds(lines[1])).toEqual([['comment', '# header']])
    expect(kinds(lines[2])).toEqual([
      ['key', 'sonic_config_asn'],
      ['punct', ':'],
      ['number', '4200000001'],
    ])
    expect(kinds(lines[3])).toEqual([
      ['key', 'lo'],
      ['punct', ':'],
      ['string', '"'],
      ['template', '{{ sonic_config_loopback_address }}'],
      ['string', '"'],
    ])
    expect(kinds(lines[4])).toEqual([
      ['key', 'flag'],
      ['punct', ':'],
      ['literal', 'false'],
      ['comment', '# note'],
    ])
    expect(kinds(lines[6])).toEqual([
      ['punct', '- '],
      ['plain', 'Ethernet120'],
    ])
    expect(kinds(lines[7])).toEqual([
      ['key', 'key'],
      ['punct', ':'],
      ['placeholder', 'CHANGE_ME'],
    ])
    expect(kinds(lines[8])[0]).toEqual(['key', 'partition-1:1-mgmt-server'])
    expect(kinds(lines[9]).slice(2)).toEqual([
      ['plain', 'oci://ghcr.io/x:'],
      ['template', '{{ v }}'],
    ])
  })

  it('keeps block scalars as text', () => {
    const lines = yamlTokens('run: |\n  if [ -n "$x" ]; then\n    echo a: b\n  fi\nnext: 1')
    expect(kinds(lines[0]).at(-1)).toEqual(['punct', '|'])
    expect(kinds(lines[2])).toEqual([['plain', '    echo a: b']])
    expect(kinds(lines[4])[0]).toEqual(['key', 'next'])
    expect(kinds(yamlTokens('s: |\n  grep CHANGE_ME x')[1])).toEqual([
      ['plain', '  grep CHANGE_ME x'],
    ])
  })

  it('loses no text on any generated file', () => {
    for (const f of deriveAnsible(createEmptyPlan()).files) {
      if (!/\.ya?ml$/.test(f.path)) continue
      const back = yamlTokens(f.content)
        .map((line) => line.map((t) => t.text).join(''))
        .join('\n')
      expect(back, f.path).toBe(f.content.replace(/\n$/, ''))
    }
  })
})

describe('INI tokens', () => {
  it('colors sections, keys and comments', () => {
    const [comment, section, entry] = iniTokens('# x\n[defaults]\nroles_path = roles\n')
    expect(comment[0].kind).toBe('comment')
    expect(section[0].kind).toBe('literal')
    expect(entry.map((t) => t.kind)).toEqual(['key', 'punct', 'string'])
  })
})

describe('markdown', () => {
  it('splits the README into blocks', () => {
    const readme = deriveAnsible(createEmptyPlan()).files.find((f) => f.path === 'README.md')!
    const blocks = markdownBlocks(readme.content)
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 })
    expect(blocks.some((b) => b.kind === 'code' && b.lang === 'sh')).toBe(true)
    const table = blocks.find((b) => b.kind === 'table')
    expect(table && table.kind === 'table' && table.header).toEqual(['File', 'Variable', 'What'])
  })

  it('treats lines no block takes as text', () => {
    expect(markdownBlocks('| not a table\n```sh extra')).toEqual([
      { kind: 'paragraph', text: '| not a table' },
      { kind: 'paragraph', text: '```sh extra' },
    ])
  })

  it('parses lists, paragraphs and inline spans', () => {
    expect(markdownBlocks('- a\n- b\n\nsome\ntext')).toEqual([
      { kind: 'list', items: ['a', 'b'] },
      { kind: 'paragraph', text: 'some text' },
    ])
    expect(inlineSpans('run `make` **now**')).toEqual([
      { kind: 'text', text: 'run ' },
      { kind: 'code', text: 'make' },
      { kind: 'text', text: ' ' },
      { kind: 'strong', text: 'now' },
    ])
  })
})
