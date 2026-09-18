import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { deriveAnsible } from '../derive/ansible'
import { createEmptyPlan } from '../model/defaults'
import { ansibleZip } from './ansibleZip'

describe('Ansible zip', () => {
  it('packs every file under one folder', async () => {
    const { files } = deriveAnsible(createEmptyPlan())
    const bytes = await ansibleZip(files, 'plan-ansible')
    const zip = await JSZip.loadAsync(bytes)
    const names = Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name)
    expect(names.sort()).toEqual(files.map((f) => `plan-ansible/${f.path}`).sort())
    const inventory = files.find((f) => f.path.endsWith('inventory.yaml'))!
    expect(await zip.file(`plan-ansible/${inventory.path}`)!.async('string')).toBe(
      inventory.content,
    )
  })
})
