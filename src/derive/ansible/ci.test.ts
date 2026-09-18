import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { createEmptyPlan, defaultPartition } from '../../model/defaults'
import type { Plan } from '../../model/plan'
import { deriveAnsible } from './index'

function plan(ci: Partial<Plan['deployment']['ci']> = {}): Plan {
  const p = createEmptyPlan()
  p.partitions.push(defaultPartition('Partition 2'))
  p.deployment.ci = { ...p.deployment.ci, ...ci }
  return p
}

const file = (p: Plan, path: string) => {
  const f = deriveAnsible(p).files.find((f) => f.path === path)
  return f && parse(f.content)
}

describe('CI/CD pipelines', () => {
  it('generates GitLab CI by default, GitHub Actions on request, nothing for none', () => {
    const paths = (p: Plan) => deriveAnsible(p).files.map((f) => f.path)
    const ciPaths = (p: Plan) => paths(p).filter((f) => /gitlab-ci|\.github/.test(f))
    expect(ciPaths(plan())).toEqual(['.gitlab-ci.yml'])
    expect(ciPaths(plan({ platform: 'github' }))).toEqual([
      '.github/workflows/check.yaml',
      '.github/workflows/deploy.yaml',
    ])
    expect(ciPaths(plan({ platform: 'both' }))).toHaveLength(3)
    expect(ciPaths(plan({ platform: 'none' }))).toEqual([])
  })

  it('deploys each partition by hand, in order, on its own runner', () => {
    const gl = file(plan({ runnerTags: { unknown: 'x' } }), '.gitlab-ci.yml')
    expect(gl.stages).toEqual(['check', 'deploy'])
    expect(gl.check.script.join('\n')).toContain('--syntax-check')
    expect(gl['.deploy'].rules).toEqual([{ if: '$CI_COMMIT_BRANCH == "main"', when: 'manual' }])
    expect(gl['partition-2:1-mgmt-server']).toMatchObject({
      extends: '.deploy',
      tags: ['partition-2'],
      resource_group: 'partition-2',
      environment: { name: 'prod/partition-2' },
      needs: ['check'],
      script: ['ansible-playbook deploy_mgmt_server.yaml --limit partition_2'],
    })
    expect(gl['partition-2:2-mgmt-network'].needs).toEqual(['partition-2:1-mgmt-server'])
    expect(gl['partition-2:3-prod-network'].needs).toEqual(['partition-2:2-mgmt-network'])
    expect(gl['partition-1:dry-run'].script[0]).toContain('--check --diff')
  })

  it('takes runner tags, branch, SSH user and the dry run from the settings', () => {
    const p = plan({
      platform: 'both',
      branch: 'production',
      sshUser: 'deploy',
      hostKeyChecking: false,
      dryRun: false,
    })
    p.deployment.ci.runnerTags = { [p.partitions[0].id]: 'dc1-mgmt' }
    const gl = file(p, '.gitlab-ci.yml')
    expect(gl.variables).toEqual({
      ANSIBLE_FORCE_COLOR: '1',
      ANSIBLE_HOST_KEY_CHECKING: 'False',
      ANSIBLE_REMOTE_USER: 'deploy',
    })
    expect(gl['partition-1:1-mgmt-server'].tags).toEqual(['dc1-mgmt'])
    expect(gl['.deploy'].rules[0].if).toBe('$CI_COMMIT_BRANCH == "production"')
    expect(Object.keys(gl).some((k) => k.endsWith(':dry-run'))).toBe(false)

    const gh = file(p, '.github/workflows/deploy.yaml')
    expect(Object.keys(gh.on.workflow_dispatch.inputs)).toEqual(['partition', 'playbook'])
    expect(gh.on.workflow_dispatch.inputs.partition.options).toEqual(['partition-1', 'partition-2'])
    expect(gh.jobs['partition-1']).toMatchObject({
      if: "inputs.partition == 'partition-1' && github.ref_name == 'production'",
      'runs-on': ['self-hosted', 'dc1-mgmt'],
      environment: 'prod-partition-1',
    })
    const steps = gh.jobs['partition-1'].steps.map((s: { name?: string }) => s.name)
    expect(steps).toEqual([
      undefined,
      'Install credentials',
      'Install roles and collections',
      'Management servers',
      'Management network',
      'Production network',
    ])
    expect(file(p, '.github/workflows/check.yaml').on.push.branches).toEqual(['production'])
  })

  it('offers a dry run input on GitHub that also works off the deploy branch', () => {
    const gh = file(plan({ platform: 'github' }), '.github/workflows/deploy.yaml')
    expect(gh.on.workflow_dispatch.inputs.dry_run).toMatchObject({ type: 'boolean', default: true })
    expect(gh.jobs['partition-1'].if).toContain("(inputs.dry_run || github.ref_name == 'main')")
    expect(gh.jobs['partition-1'].steps[3].run).toContain("inputs.dry_run && '--check --diff'")
  })

  it('reaches metal-api and NSQ under the control plane domain', () => {
    const p = plan()
    const open = () => deriveAnsible(p).placeholders.map((x) => x.key)
    expect(open()).toContain('metal_control_plane_ingress_dns')
    p.deployment.controlPlaneDomain = 'metal.example.com'
    expect(open()).not.toContain('metal_control_plane_ingress_dns')
    expect(file(p, 'inventories/prod/group_vars/partition/metal.yaml')).toMatchObject({
      metal_control_plane_ingress_dns: 'metal.example.com',
      metal_partition_metal_api_addr: 'api.{{ metal_control_plane_ingress_dns }}',
      metal_bmc_nsqd_addr: '{{ metal_control_plane_ingress_dns }}:4150',
    })
  })
})
