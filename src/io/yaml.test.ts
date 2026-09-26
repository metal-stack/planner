import { describe, expect, it } from 'vitest'
import { toYaml } from './yaml'

describe('toYaml', () => {
  it('quotes every string, so YAML never reinterprets it', () => {
    expect(toYaml({ a: 'no', b: '1.10', c: '{{ lo }}', d: 'on' })).toBe(
      'a: "no"\nb: "1.10"\nc: "{{ lo }}"\nd: "on"\n',
    )
  })

  it('writes numbers and booleans bare', () => {
    expect(toYaml({ asn: 4200000001, enabled: true })).toBe('asn: 4200000001\nenabled: true\n')
  })

  it('nests maps and lists, and writes empty ones inline', () => {
    expect(
      toYaml({ vlans: [{ id: 4000, ports: ['Ethernet0', 'Ethernet4'] }], none: [], empty: {} }),
    ).toBe(
      [
        'vlans:',
        '  - id: 4000',
        '    ports:',
        '      - "Ethernet0"',
        '      - "Ethernet4"',
        'none: []',
        'empty: {}',
        '',
      ].join('\n'),
    )
  })

  it('quotes keys that are not plain identifiers', () => {
    expect(toYaml({ 'p1-spine01': { 'a b': 1 } })).toBe('p1-spine01:\n  "a b": 1\n')
  })

  it('leaves out undefined values instead of writing a placeholder', () => {
    expect(toYaml({ set: 1, missing: undefined })).toBe('set: 1\n')
  })
})
