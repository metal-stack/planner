import { describe, expect, it } from 'vitest'
import { catalog, dimmTypeForSocket, type CpuSocket } from './catalog'
import { nodeSizes, resolveNodeCompute } from './sizes'

describe('node size catalog references', () => {
  it('resolves every size to matching CPU and memory parts', () => {
    for (const size of nodeSizes) {
      for (const [socket, parts] of Object.entries(size.parts)) {
        const cpu = catalog[parts.cpuModelId]
        const dimm = catalog[parts.dimmModelId]
        expect(cpu?.category, `${size.id} ${socket} CPU`).toBe('cpu')
        expect(cpu?.socket, `${size.id} ${socket} CPU socket`).toBe(socket)
        expect(cpu?.cores, `${size.id} ${socket} CPU cores`).toBe(size.cores)
        expect(dimm?.category, `${size.id} ${socket} DIMM`).toBe('memory')
        expect(dimm?.dimmType, `${size.id} ${socket} DIMM type`).toBe(
          dimmTypeForSocket[socket as CpuSocket],
        )
        expect(parts.dimmsPerNode * (dimm?.dimmGiB ?? 0), `${size.id} ${socket} memory`).toBe(
          size.memoryGiB,
        )
      }
    }
  })
})

describe('resolveNodeCompute', () => {
  const preset = {
    modelId: 'server-microcloud-h13',
    sizeId: 'n1-medium-x86',
  }

  it('resolves the board-specific preset', () => {
    expect(resolveNodeCompute(preset)).toEqual({
      size: nodeSizes[0],
      cpuModelId: 'cpu-epyc-4344p',
      dimmModelId: 'mem-ddr5u-16g',
      dimmsPerNode: 2,
      custom: false,
    })
  })

  it('overlays a partial custom configuration', () => {
    expect(
      resolveNodeCompute({ ...preset, compute: { dimmModelId: 'mem-ddr5u-32g' } }),
    ).toMatchObject({
      cpuModelId: 'cpu-epyc-4344p',
      dimmModelId: 'mem-ddr5u-32g',
      dimmsPerNode: 2,
      custom: true,
    })
  })

  it('leaves parts undefined for an unknown size', () => {
    expect(resolveNodeCompute({ ...preset, sizeId: 'x1-huge' })).toEqual({
      size: undefined,
      cpuModelId: undefined,
      dimmModelId: undefined,
      dimmsPerNode: undefined,
      custom: false,
    })
  })

  it('leaves parts undefined when a size is unavailable on the socket', () => {
    expect(resolveNodeCompute({ ...preset, sizeId: 'c1-large-x86' })).toMatchObject({
      cpuModelId: undefined,
      dimmModelId: undefined,
      dimmsPerNode: undefined,
      custom: false,
    })
  })

  it('resolves a fully overridden size unavailable on the socket', () => {
    expect(
      resolveNodeCompute({
        ...preset,
        sizeId: 'c1-large-x86',
        compute: {
          cpuModelId: 'cpu-epyc-4344p',
          dimmModelId: 'mem-ddr5u-32g',
          dimmsPerNode: 4,
        },
      }),
    ).toMatchObject({
      cpuModelId: 'cpu-epyc-4344p',
      dimmModelId: 'mem-ddr5u-32g',
      dimmsPerNode: 4,
      custom: true,
    })
  })
})
