import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { fromObject, kv, note, toYaml, toYamlSeq, ymap } from './yaml'

describe('yaml writer', () => {
  it('writes nested maps, sequences and comments', () => {
    const text = toYaml(
      ymap(
        note('derived from the plan'),
        kv('asn', 4200000001),
        kv('lo', '{{ sonic_config_loopback_address }}'),
        kv('mgmt', ymap(kv('ip', '10.0.0.2/24'), kv('gateway_address', '10.0.0.1'))),
        kv('servers', ['192.0.2.1', '192.0.2.2']),
        kv('vlans', [ymap(kv('id', 4000), kv('ip', '10.1.0.1/27'))]),
        kv('empty', []),
        kv('flag', 'yes', 'a string, not a boolean'),
      ),
      'header',
    )
    expect(text.startsWith('---\n# header\n# derived from the plan\nasn: 4200000001\n')).toBe(true)
    expect(parse(text)).toEqual({
      asn: 4200000001,
      lo: '{{ sonic_config_loopback_address }}',
      mgmt: { ip: '10.0.0.2/24', gateway_address: '10.0.0.1' },
      servers: ['192.0.2.1', '192.0.2.2'],
      vlans: [{ id: 4000, ip: '10.1.0.1/27' }],
      empty: [],
      flag: 'yes',
    })
  })

  it('quotes YAML 1.1 booleans, which Ansible and GitHub read as such', () => {
    expect(toYaml(ymap(kv('on', 'off'), kv('a', 'yes')))).toBe('---\n"on": "off"\na: "yes"\n')
  })

  it('writes bare keys for null values (inventory hosts)', () => {
    const text = toYaml(ymap(kv('hosts', ymap(kv('leaf01', null), kv('leaf02', null)))))
    expect(text).toContain('  leaf01:\n')
    expect(parse(text)).toEqual({ hosts: { leaf01: null, leaf02: null } })
  })

  it('writes sequence documents', () => {
    const text = toYamlSeq([fromObject({ name: 'play', hosts: 'leaves', roles: ['a', 'b'] })])
    expect(parse(text)).toEqual([{ name: 'play', hosts: 'leaves', roles: ['a', 'b'] }])
  })

  it('writes multi-line strings as literal blocks', () => {
    const run = 'set -eu\nfor p in deploy_*.yaml; do\n  ansible-playbook "$p"\ndone\n'
    const text = toYaml(ymap(kv('run', run), kv('script', ['echo a', 'x\ny'])))
    expect(text).toContain('run: |\n  set -eu\n')
    expect(parse(text)).toEqual({ run, script: ['echo a', 'x\ny\n'] })
  })

  it('refuses multi-line keys', () => {
    expect(() => toYaml(ymap(kv('a\nb', 1)))).toThrow()
  })
})
